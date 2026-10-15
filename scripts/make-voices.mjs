#!/usr/bin/env node
// Records the patient voice library (data/voices.js) with Gemini text-to-speech, once, into
// voices/<voice>/<phrase>.mp3, then writes data/voice-clips.js listing every clip that exists.
// The site never calls Gemini: it only plays these files.
//
//   node scripts/make-voices.mjs --estimate          what it would make and roughly cost, no calls
//   node scripts/make-voices.mjs                      make every clip that does not exist yet
//   node scripts/make-voices.mjs --voice man --only yes,no   just these
//   node scripts/make-voices.mjs --redo               remake clips that already exist
//   node scripts/make-voices.mjs --list               only rewrite data/voice-clips.js
//
// Needs curl and ffmpeg. The key is GEMINI_API_KEY (sent as x-goog-api-key); without it the request
// goes out bare, which works only behind a proxy that adds the key itself.
// Each clip is checked by transcribing it back with a cheap model; a clip whose words do not match is
// tried once more, and anything still wrong is listed at the end and not saved.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TTS_MODEL = 'gemini-3.8-flash-tts';
const CHECK_MODEL = 'gemini-2.5-flash-lite';
// Google's list price for TTS_MODEL (checked 15 Oct 2026): $9 per million audio tokens, 25 tokens a second.
const USD_PER_AUDIO_TOKEN = 9 / 1e6, TOKENS_PER_SECOND = 25;

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data', 'voices.js'), 'utf8'), sandbox);
const LIB = sandbox.window.VOICE_LIBRARY;
const voiceIds = opt('--voice') ? opt('--voice').split(',') : LIB.voices.map(v => v.id);
const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
const phrases = LIB.groups.flatMap(g => g.phrases.map(p => ({ ...p, sound: !!g.sounds })));
const clipPath = (v, p) => path.join(ROOT, 'voices', v, `${p}.mp3`);

function writeClipList() {
    const have = [];
    for (const v of LIB.voices) for (const p of phrases) if (fs.existsSync(clipPath(v.id, p.id))) have.push(`${v.id}/${p.id}`);
    fs.writeFileSync(path.join(ROOT, 'data', 'voice-clips.js'),
        '// Written by scripts/make-voices.mjs: the patient voice clips that exist in voices/. Do not edit by hand.\n'
        + `window.VOICE_CLIPS = ${JSON.stringify(have)};\n`);
    console.log(`[voices] data/voice-clips.js lists ${have.length} clips`);
}
if (flag('--list')) { writeClipList(); process.exit(0); }

const jobs = [];
for (const vid of voiceIds) {
    const voice = LIB.voices.find(v => v.id === vid);
    if (!voice) throw new Error(`unknown voice ${vid}`);
    for (const p of phrases) {
        if (only && !only.has(p.id)) continue;
        if (!flag('--redo') && fs.existsSync(clipPath(vid, p.id))) continue;
        jobs.push({ voice, phrase: p });
    }
}
const estSeconds = jobs.reduce((s, j) => s + (j.phrase.sound ? 3 : 1.2 + j.phrase.text.split(/\s+/).length * 0.4), 0);
console.log(`[voices] ${jobs.length} clips to make, about ${Math.round(estSeconds)} s of audio, about $${(estSeconds * TOKENS_PER_SECOND * USD_PER_AUDIO_TOKEN).toFixed(2)} before any retries`);
if (flag('--estimate') || !jobs.length) { if (!jobs.length) writeClipList(); process.exit(0); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'voices-'));
const gemini = (model, body) => {
    const bodyFile = path.join(TMP, 'body.json');
    fs.writeFileSync(bodyFile, JSON.stringify(body));
    const curlArgs = ['-sS', '--fail-with-body', '--retry', '3', '--retry-delay', '5', '-X', 'POST',
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        '-H', 'Content-Type: application/json', '--data-binary', `@${bodyFile}`];
    if (process.env.GEMINI_API_KEY) curlArgs.push('-H', `x-goog-api-key: ${process.env.GEMINI_API_KEY}`);
    const out = JSON.parse(execFileSync('curl', curlArgs, { maxBuffer: 64 << 20 }).toString());
    if (out.error) throw new Error(`${model}: ${out.error.message}`);
    return out;
};

const promptFor = (voice, p) => p.sound
    ? `Perform this as ${voice.who}, a patient in a hospital emergency department: ${p.direction}. Do not say any words.`
    : `Read this line as ${voice.who}, a patient in a hospital emergency department who is unwell and worried, `
      + `speaking naturally with a British accent. Say only the words in quotes, nothing else: "${p.text}"`;

const norm = (s) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
let audioTokens = 0, checkTokens = 0;
const failed = [];

function makeOne({ voice, phrase }) {
    const res = gemini(TTS_MODEL, {
        contents: [{ parts: [{ text: promptFor(voice, phrase) }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.gemini } } } }
    });
    audioTokens += res.usageMetadata?.candidatesTokenCount || 0;
    const part = res.candidates?.[0]?.content?.parts?.find(x => x.inlineData);
    if (!part) throw new Error('no audio in the reply');
    const raw = path.join(TMP, 'raw'), mp3 = path.join(TMP, 'clip.mp3');
    fs.writeFileSync(raw, Buffer.from(part.inlineData.data, 'base64'));
    // Older models send bare 24 kHz 16-bit PCM, newer ones a WAV: tell ffmpeg which.
    const isWav = fs.readFileSync(raw).subarray(0, 4).toString() === 'RIFF';
    const input = isWav ? ['-i', raw] : ['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', raw];
    // Trim the silence at each end, then bring every clip to the same loudness (-14 LUFS, peaks under
    // -1 dB) so no phrase is noticeably quieter than the next.
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...input, '-af',
        'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse,loudnorm=I=-14:TP=-1:LRA=11',
        '-ar', '24000', '-ac', '1', '-b:a', '48k', mp3]);
    const check = gemini(CHECK_MODEL, {
        contents: [{ parts: [
            { inlineData: { mimeType: 'audio/mp3', data: fs.readFileSync(mp3).toString('base64') } },
            { text: 'Transcribe exactly the words spoken in this audio, nothing else. If there are no words (only sounds such as groaning, coughing or crying), reply NONE.' }
        ] }]
    });
    checkTokens += check.usageMetadata?.totalTokenCount || 0;
    const heard = (check.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join(' ').trim();
    const ok = phrase.sound ? /^none\.?$/i.test(heard) || norm(heard).split(' ').length <= 2 : norm(heard) === norm(phrase.text);
    return { ok, heard, mp3 };
}

let made = 0;
for (const job of jobs) {
    const name = `${job.voice.id}/${job.phrase.id}`;
    let result = null;
    for (let attempt = 1; attempt <= 2 && !(result && result.ok); attempt++) {
        try { result = makeOne(job); } catch (e) { result = { ok: false, heard: `ERROR ${e.message}` }; }
        if (!result.ok) console.log(`[voices] ${name} attempt ${attempt}: heard "${result.heard}"`);
    }
    if (result.ok) {
        fs.mkdirSync(path.dirname(clipPath(job.voice.id, job.phrase.id)), { recursive: true });
        fs.copyFileSync(result.mp3, clipPath(job.voice.id, job.phrase.id));
        made++;
        if (made % 20 === 0) console.log(`[voices] ${made}/${jobs.length}`);
    } else failed.push(`${name}: heard "${result.heard}"`);
}
fs.rmSync(TMP, { recursive: true, force: true });
writeClipList();
console.log(`[voices] made ${made}, failed ${failed.length}; ${audioTokens} audio tokens = $${(audioTokens * USD_PER_AUDIO_TOKEN).toFixed(3)} for speech, ${checkTokens} tokens for the checks`);
if (failed.length) console.log('[voices] not saved:\n  ' + failed.join('\n  '));
