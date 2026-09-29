// End-to-end tests with the REAL Firebase SDK against the Firebase emulator, which enforces
// database.rules.json. Run inside `firebase emulators:exec` (see the CI job "e2e").
const base = require('./playwright.config.js');
module.exports = { ...base, testDir: './e2e', fullyParallel: false, workers: 1 };
