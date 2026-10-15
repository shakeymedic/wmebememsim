// =====================================================================================================
// INVESTIGATION RESULTS: real images and the reports that go with them.
//
// IMAGES. Every image is a real, openly licensed clinical image from Wikimedia Commons, stored in
// images/investigations/ (resized, and cropped where noted). Each entry carries its author, licence
// and source page, which the monitor and controller show as a credit, and guides/image-credits.html
// lists in full. Only CC0 / public domain / CC BY / CC BY-SA images are used. Nothing is mirrored:
// a flipped radiograph is anatomically wrong, so each report names the side the image shows.
//
// FINDINGS. Each finding is a report written to describe exactly what its image shows (or, where no
// suitable image exists, a report on its own). The facilitator's result picker lists them by type,
// with a thumbnail, and each scenario's own result ("Scenario finding") comes from SCENARIO_RESULTS.
//
// ECG IMAGES are snapshots of a particular rhythm, so each lists the rhythms it may stand in for. The
// room monitor only shows the real ECG while the patient is in one of them; otherwise it draws the
// 12-lead from the live rhythm as before (so a STEMI tracing never appears once the patient is in VF).
// =====================================================================================================
// This file is a plain script (not compiled by Babel). Do not use object spread ({ ...x }) here: the
// build lowers it to helper functions with short GLOBAL names, which overwrote the Firebase SDK's own
// globals and stopped the database starting. scripts/build.mjs refuses to build if that happens.
(() => {
    const SINUS = ['Sinus Rhythm', 'Sinus Tachycardia', 'Sinus Bradycardia', 'STEMI', 'Hyperkalaemia', '1st Deg Heart Block'];
    const C = (author, licence, file, modified) => ({
        author, licence,
        licenceUrl: ({
            'CC0': 'https://creativecommons.org/publicdomain/zero/1.0/',
            'Public domain': 'https://commons.wikimedia.org/wiki/Commons:Licensing',
            'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
            'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
            'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
            'CC BY-SA 2.5': 'https://creativecommons.org/licenses/by-sa/2.5/',
            'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
            'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/'
        })[licence] || 'https://commons.wikimedia.org/wiki/Commons:Licensing',
        source: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file.replace(/ /g, '_')),
        file,
        modified: modified || 'Resized'
    });

    // ---- The image library (key -> file and credit) ---------------------------------------------
    const IMAGES = {
        'cxr-normal': Object.assign({ modality: 'X-ray' }, C('Mikael Häggström', 'CC0', 'Normal posteroanterior (PA) chest radiograph (X-ray).jpg')),
        'cxr-ptx-tension': Object.assign({ modality: 'X-ray' }, C('Hellerhoff', 'CC BY-SA 3.0', 'Spontanpneumothorax rechts 2012.jpg')),
        'cxr-ptx-simple': Object.assign({ modality: 'X-ray' }, C('Hellerhoff', 'CC BY-SA 4.0', 'Pneumothorax rechts nach Sturz 30W - CR pa - 001.jpg')),
        'cxr-ptx-spontaneous': Object.assign({ modality: 'X-ray' }, C('Hellerhoff', 'CC BY-SA 4.0', 'Maessiger Spannungspneumothorax links 21M - CR pa - 001.jpg')),
        'cxr-pneumonia': Object.assign({ modality: 'X-ray' }, C('Mikael Häggström', 'CC0', 'X-ray of lobar pneumonia.jpg')),
        'cxr-pneumonia-2': Object.assign({ modality: 'X-ray' }, C('Hellerhoff', 'CC BY-SA 3.0', 'Mittellappenpneumonie.jpg')),
        'cxr-oedema': Object.assign({ modality: 'X-ray' }, C('Hellerhoff', 'CC BY-SA 4.0', 'Schmetterlingsoedem bei kardialer Dekompensation 64W - CR ap - 001.jpg')),
        'cxr-oedema-shock': Object.assign({ modality: 'X-ray' }, C('Hellerhoff', 'CC BY-SA 4.0', 'Lungenoedem bei kardiogenem Schock 73M - CR ap - 001.jpg')),
        'cxr-drowning': Object.assign({ modality: 'X-ray' }, C('Dr Terence McManus', 'CC BY-SA 4.0', 'Salt water aspiration syndrome chest x-ray, before treatment.png')),
        'cxr-ards': Object.assign({ modality: 'X-ray' }, C('James Heilman, MD', 'CC BY-SA 4.0', 'ARDSSevere.png')),
        'cxr-effusion': Object.assign({ modality: 'X-ray' }, C('Clinical Cases (clinicalcases.org)', 'CC BY-SA 2.5', 'Left-sided Pleural Effusion.jpg')),
        'cxr-haemothorax': Object.assign({ modality: 'X-ray' }, C('Hamid Reza Mahoozi, Jan Volmerig and Erich Hecker', 'CC BY 4.0', 'Chest-X-ray-Left-sided-hemothorax.png')),
        'cxr-free-air': Object.assign({ modality: 'X-ray' }, C('Hellerhoff', 'CC BY-SA 4.0', 'Freie Luft bei Sigmaperforation 71W - CR ap - 001.jpg')),
        'cxr-pneumomediastinum': Object.assign({ modality: 'X-ray' }, C('Hellerhoff', 'CC BY-SA 4.0', 'Mediastinalemphysem Perforation Oesophaguskarzinom.jpg')),
        'cxr-copd': Object.assign({ modality: 'X-ray' }, C('James Heilman, MD', 'CC BY-SA 3.0', 'COPD.JPG')),
        'cxr-pericardial-effusion': Object.assign({ modality: 'X-ray' }, C('James Heilman, MD', 'CC BY-SA 3.0', 'PericardialeffusionCXR.PNG')),
        'cxr-bronchiolitis': Object.assign({ modality: 'X-ray' }, C('Matteo Di Nardo, Daniela Perrotta, Francesca Stoppa, Corrado Cecchetti, Marco Marano and Nicola Pirozzi', 'CC BY 2.0', 'Bronchiolitis chest X-ray.jpg')),
        'xr-nof': Object.assign({ modality: 'X-ray' }, C('Hellerhoff', 'CC BY-SA 4.0', 'Laterale Schenkelhalsfraktur links 44W - CR ap - 001.jpg')),
        'xr-supracondylar': Object.assign({ modality: 'X-ray' }, C('James Heilman, MD', 'CC BY-SA 4.0', 'Supracondylarfrac.png')),
        'ct-normal-head': Object.assign({ modality: 'CT' }, C('Mikael Häggström', 'CC0', 'CT of a normal brain, axial 18.png', 'Cropped to the axial slice (scout image removed); resized')),
        'ct-sah': Object.assign({ modality: 'CT' }, C('Hellerhoff', 'CC BY-SA 4.0', 'Basale Subarachnoidalblutung bei Anterioraneurysma 43M - CT axial - 001.jpg', 'Cropped to one axial slice; resized')),
        'ct-dense-mca': Object.assign({ modality: 'CT' }, C('Hellerhoff', 'CC BY-SA 3.0', 'Dens media sign mit Mediainfarkt - CCT 001.jpg', 'Cropped to the first (early) scan; resized')),
        'ct-ich': Object.assign({ modality: 'CT' }, C('James Heilman, MD', 'CC BY-SA 4.0', 'Intra Parenchymal Bleed with Edema.jpg')),
        'ct-subdural': Object.assign({ modality: 'CT' }, C('Glitzy queen00 (English Wikipedia)', 'Public domain', 'Trauma subdural.jpg', 'A mouse pointer photographed on the screen was removed (filled from the surrounding brain); resized')),
        'ct-edh': Object.assign({ modality: 'CT' }, C('Hellerhoff', 'CC BY-SA 4.0', 'Grosses epidurales Haematom nach Sturz 87W - CT - 001.jpg', 'Cropped to the axial slice; resized')),
        'ct-hydrocephalus': Object.assign({ modality: 'CT' }, C('Lucien Monfils', 'CC BY-SA 3.0', 'Hydrocephalus.jpg')),
        'ct-pe': Object.assign({ modality: 'CT' }, C('Hellerhoff', 'CC BY-SA 3.0', 'Reitender Thrombus bei Lungenembolie - CT - axial - 008.jpg')),
        'ct-pancreatitis': Object.assign({ modality: 'CT' }, C('Hellerhoff', 'CC BY-SA 3.0', 'Akute exsudative Pankreatitis - CT axial.jpg')),
        'ct-spleen': Object.assign({ modality: 'CT' }, C('Hellerhoff', 'CC BY-SA 4.0', 'Traumatische Milzruptur mit subkapsulaerem Haematom 81M - CT KM pv - 001.jpg', 'Cropped to the axial image; resized')),
        'ecg-stemi-anterior': Object.assign({ modality: 'ECG', rhythms: SINUS }, C('Displaced (Wikimedia Commons)', 'Public domain', '12 Lead EKG ST Elevation tracing only.jpg')),
        'ecg-stemi-anterior-2': Object.assign({ modality: 'ECG', rhythms: SINUS }, C('Joshua Coutinho, Justin B Field and Anupam A Sule (Cureus 2018;10:e2523)', 'CC BY 4.0', 'ST elevation myocardial infarction ECG (cropped).jpg')),
        'ecg-stemi-inferior': Object.assign({ modality: 'ECG', rhythms: SINUS }, C('Glenlarson', 'Public domain', '12 lead generated inferior MI.JPG', 'Cropped to remove the machine interpretation; resized')),
        'ecg-hyperkalaemia': Object.assign({ modality: 'ECG', rhythms: SINUS }, C('Michael Rosengarten, McGill University / CardioNetworks ECGpedia', 'CC BY-SA 3.0', '118 (CardioNetworks ECGpedia).jpg')),
        'ecg-pe': Object.assign({ modality: 'ECG', rhythms: SINUS }, C('R.W. Koster / ECGpedia', 'CC BY 3.0', 'Pulm embolism.jpg')),
        'ecg-chb': Object.assign({ modality: 'ECG', rhythms: ['Complete Heart Block'] }, C('Michael Rosengarten, McGill University / CardioNetworks ECGpedia', 'CC BY-SA 3.0', 'E312 (CardioNetworks ECGpedia).jpg')),
        'ecg-brugada': Object.assign({ modality: 'ECG', rhythms: SINUS }, C('P.G. Postema, AMC / CardioNetworks ECGpedia', 'CC BY-SA 3.0', 'Brugada syndrome type1 example4 (CardioNetworks ECGpedia).png')),
        'ecg-alternans': Object.assign({ modality: 'ECG', rhythms: SINUS }, C('James Heilman, MD', 'CC BY-SA 3.0', 'Electrical Alternans.JPG')),
        'ecg-wellens': Object.assign({ modality: 'ECG', rhythms: SINUS }, C('James Heilman, MD', 'CC BY-SA 3.0', 'WellensPainfree.JPG')),
        'ecg-lvh': Object.assign({ modality: 'ECG', rhythms: SINUS }, C('CardioNetworks ECGpedia', 'CC BY-SA 3.0', 'Extreme lvh2 (CardioNetworks ECGpedia).jpg')),
        'ecg-long-qt': Object.assign({ modality: 'ECG', rhythms: SINUS }, C('CardioNetworks ECGpedia', 'CC BY-SA 3.0', 'Lqts1 (CardioNetworks ECGpedia).png')),
        'us-b-lines': Object.assign({ modality: 'POCUS' }, C('Tinss', 'CC BY-SA 4.0', 'B lines on a lung ultrasound of a patient with fibrosis.jpg')),
        'us-pyloric': Object.assign({ modality: 'POCUS' }, C('Dr Laughlin Dawes', 'CC BY-SA 4.0', 'PyloricStenosisUS.jpg')),
        // Ultrasound from journal video supplements (and two ultrasound-of-the-week clips): each has a still
        // frame (.jpg) and a short silent loop (.webp, listed in LOOPS below) that the room monitor plays.
        'us-fast-positive': Object.assign({ modality: 'POCUS' }, C('Gillman L, Ball C, Panebianco N, Al-Kadi A, Kirkpatrick A (Scand J Trauma Resusc Emerg Med 2009;17:34)', 'CC BY 2.0', 'Clinician-performed-resuscitative-ultrasonography-for-the-initial-evaluation-and-resuscitation-of-1757-7241-17-34-S1.ogv', 'A short loop and a still cut from the video, cropped to the scan')),
        'us-pleural-effusion': Object.assign({ modality: 'POCUS' }, C('Gillman L, Ball C, Panebianco N, Al-Kadi A, Kirkpatrick A (Scand J Trauma Resusc Emerg Med 2009;17:34)', 'CC BY 2.0', 'Clinician-performed-resuscitative-ultrasonography-for-the-initial-evaluation-and-resuscitation-of-1757-7241-17-34-S2.ogv', 'A short loop and a still cut from the video, cropped to the scan')),
        'us-lung-sliding': Object.assign({ modality: 'POCUS' }, C('Gillman L, Ball C, Panebianco N, Al-Kadi A, Kirkpatrick A (Scand J Trauma Resusc Emerg Med 2009;17:34)', 'CC BY 2.0', 'Clinician-performed-resuscitative-ultrasonography-for-the-initial-evaluation-and-resuscitation-of-1757-7241-17-34-S3.ogv', 'A short loop and a still cut from the video, cropped to the scan (the header with the case label removed)')),
        'us-ptx': Object.assign({ modality: 'POCUS' }, C('Gillman L, Ball C, Panebianco N, Al-Kadi A, Kirkpatrick A (Scand J Trauma Resusc Emerg Med 2009;17:34)', 'CC BY 2.0', 'Clinician-performed-resuscitative-ultrasonography-for-the-initial-evaluation-and-resuscitation-of-1757-7241-17-34-S4.ogv', 'A short loop and a still cut from the video, cropped to the scan (the header with the name label removed)')),
        'us-ivc-collapse': Object.assign({ modality: 'POCUS' }, C('Gillman L, Ball C, Panebianco N, Al-Kadi A, Kirkpatrick A (Scand J Trauma Resusc Emerg Med 2009;17:34)', 'CC BY 2.0', 'Clinician-performed-resuscitative-ultrasonography-for-the-initial-evaluation-and-resuscitation-of-1757-7241-17-34-S8.ogv', 'A short loop and a still cut from the video, cropped to the scan')),
        'us-consolidation': Object.assign({ modality: 'POCUS' }, C('Gillman L, Kirkpatrick A (Scand J Trauma Resusc Emerg Med 2012;20:18)', 'CC BY 2.0', 'Portable-bedside-ultrasound-the-visual-stethoscope-of-the-21st-century-1757-7241-20-18-S5.ogv', 'A short loop and a still cut from the video, cropped to the scan (the header with the case label removed)')),
        'us-b-lines-confluent': Object.assign({ modality: 'POCUS' }, C('Tsung J, Kessler D, Shah V (Crit Ultrasound J 2012;4:16)', 'CC BY 2.0', 'Prospective-application-of-clinician-performed-lung-ultrasonography-during-the-2009-H1N1-influenza-2036-7902-4-16-S2.ogv', 'A short loop and a still cut from the video, cropped to the scan (the header with the case label removed)')),
        'us-pericardial-effusion': Object.assign({ modality: 'POCUS' }, C('AMC Echolab, The Netherlands / CardioNetworks ECHOpedia', 'CC BY-SA 3.0', 'Pericardial effusion, "swinging heart" E00670 (CardioNetworks ECHOpedia).webm', 'A short loop and a still cut from the video, cropped to the scan')),
        'us-ivc-plethoric': Object.assign({ modality: 'POCUS' }, C('Ben Smith (ultrasoundoftheweek.com)', 'CC BY 4.0', 'UltrasoundCardiacTamponade.webm', 'A short loop and a still cut from the video, cropped to the scan (an on-screen preset icon covered)')),
        'us-tamponade': Object.assign({ modality: 'POCUS' }, C('Ben Smith (ultrasoundoftheweek.com)', 'CC BY 4.0', 'Uotw78b (convert-video-online.com).webm', 'A short loop and a still cut from the video, cropped to the scan (an on-screen preset icon covered)')),
        'us-rv-dilated': Object.assign({ modality: 'POCUS' }, C('Acharya G, Adedayo A, Prabhu H, Brinster D, Mir P (Case Rep Pulmonol 2015:481357)', 'CC BY 3.0', 'Right-Heart-Transvalvular-Embolus-with-High-Risk-Pulmonary-Embolism-in-a-Recently-Hospitalized-481357.f1.ogv', 'A short loop and a still cut from the video, cropped to the scan')),
        'us-poor-lv': Object.assign({ modality: 'POCUS' }, C('Nguyen T, Kumar K, Francis A, Walker J, Raabe M, Zieroth S, Jassal D (Cardiovasc Ultrasound 2009;7:3)', 'CC BY 2.0', 'Pseudo-cardiac-tamponade-in-the-setting-of-excess-pericardial-fat-1476-7120-7-3-S1.ogv', 'A short loop and a still cut from the video, cropped to the scan (the date stamp covered)')),
        'us-ivc-normal': Object.assign({ modality: 'POCUS' }, C('Tinss', 'CC BY-SA 4.0', 'Inferior vena cava ultrasound.gif', 'The first frame as a still, and the animation as a looping clip; resized')),
        // Ultrasound stills.
        'us-fast-positive-2': Object.assign({ modality: 'POCUS' }, C('James Heilman, MD', 'CC BY-SA 3.0', 'FluidMorisonsPouchEctop.PNG', 'An arrow and on-screen text removed (filled from the surrounding scan); resized')),
        'us-fast-negative': Object.assign({ modality: 'POCUS' }, C('Drahreg01', 'CC BY-SA 3.0', 'MorisonNoText.png', 'Cropped to the scan (machine text and date removed); resized')),
        'us-aaa': Object.assign({ modality: 'POCUS' }, C('Mikael Häggström', 'CC0', 'Ultrasonography of abdominal aortic aneurysm in axial plane.jpg')),
        'us-aaa-long': Object.assign({ modality: 'POCUS' }, C('Mikael Häggström', 'CC0', 'Ultrasonography of abdominal aortic aneurysm in sagittal plane.jpg')),
        'us-aorta-normal': Object.assign({ modality: 'POCUS' }, C('James Heilman, MD', 'CC BY-SA 3.0', 'US normal abdominal aorta.JPG', 'Cropped (the measurement label removed); resized')),
        'us-intussusception': Object.assign({ modality: 'POCUS' }, C('Frank Gaillard', 'CC BY-SA 3.0', 'Intussusception on ultrasound.jpg')),
        'us-torsion': Object.assign({ modality: 'POCUS' }, C('Chee-Wai Mak and Wen-Sheng Tzeng', 'CC BY 3.0', 'Scrotal ultrasonography of testicular torsion.jpg')),
        'us-retinal-detachment': Object.assign({ modality: 'POCUS' }, C('CheckDO', 'CC BY-SA 4.0', 'Retinal Detachment.jpg')),
        'us-gallstones': Object.assign({ modality: 'POCUS' }, C('Mikael Häggström', 'CC0', 'Ultrasonography of sludge and gallstones.jpg')),
        'us-cholecystitis': Object.assign({ modality: 'POCUS' }, C('Mikael Häggström', 'CC0', 'Ultrasonography of cholecystitis.jpg')),
        'us-dvt': Object.assign({ modality: 'POCUS' }, C('James Heilman, MD', 'CC BY-SA 3.0', 'DVTUS.PNG', 'An arrow removed (filled from the surrounding scan); resized')),
        'us-seashore': Object.assign({ modality: 'POCUS' }, C('Tinss', 'CC BY-SA 4.0', 'Sea shore sign on a lung ultrasound.jpg', 'Cropped to the M-mode trace; resized')),
        'us-echo-a4c': Object.assign({ modality: 'POCUS' }, C('Author not named on Wikimedia Commons', 'Public domain', 'Echocardiogram 4chambers.jpg')),
        'us-bladder-trabeculated': Object.assign({ modality: 'POCUS' }, C('Mikael Häggström', 'CC0', 'Ultrasound of trabeculated urinary bladder.jpg')),
        // X-ray and CT added with the ultrasound set.
        'cxr-rll': Object.assign({ modality: 'X-ray' }, C('John Campbell', 'Public domain', 'Lobar pneumonia, right lower lobe (24187571474).jpg', 'Converted to greyscale; resized')),
        'cxr-pjp': Object.assign({ modality: 'X-ray' }, C('Samir (English Wikipedia)', 'CC BY-SA 3.0', 'PCP CAP CXR.jpg')),
        'cxr-svco': Object.assign({ modality: 'X-ray' }, C('James Heilman, MD', 'CC BY-SA 3.0', 'SVCCXR.PNG', 'A drawn circle removed; resized')),
        'cxr-rib-fractures-left': Object.assign({ modality: 'X-ray' }, C('Sjoehest', 'CC BY-SA 4.0', 'Rippenserienfraktur Röntgen Thorax.jpg', 'Cropped (the caption removed)')),
        'xr-neck-croup': Object.assign({ modality: 'X-ray' }, C('Frank Gaillard', 'CC BY-SA 3.0', 'Croup steeple sign.jpg', 'An arrow removed')),
        'xr-neck-epiglottitis': Object.assign({ modality: 'X-ray' }, C('Med Chaos', 'CC0', 'Epiglottitis.jpg', 'An arrow removed (filled from the background)')),
        'axr-lbo': Object.assign({ modality: 'X-ray' }, C('James Heilman, MD', 'CC BY-SA 3.0', 'LargeBowelObsFlat2008.jpg', 'Cropped (date text removed) and an arrow removed; resized')),
        'axr-sbo-adult': Object.assign({ modality: 'X-ray' }, C('Igboeze', 'CC BY-SA 4.0', '1. Bowel-obstruction-x-ray.jpg')),
        'ct-perforation': Object.assign({ modality: 'CT' }, C('James Heilman, MD', 'CC BY-SA 3.0', 'FreeairCT.png', 'An arrow removed; resized')),
        'ct-kub-stone': Object.assign({ modality: 'CT' }, C('James Heilman, MD', 'CC BY-SA 3.0', 'KidneyStone.JPG', 'An arrow removed; resized')),
        'ct-cerebellar': Object.assign({ modality: 'CT' }, C('James Heilman, MD', 'CC BY-SA 3.0', 'Leftsidedcerebellarstroke.PNG', 'An arrow removed; resized')),
        'ct-aaa': Object.assign({ modality: 'CT' }, C('James Heilman, MD', 'CC BY-SA 3.0', 'RupturedAAA.png', 'Two arrows removed; resized')),
        'ct-dissection-b': Object.assign({ modality: 'CT' }, C('JasonRobertYoungMD', 'CC BY-SA 4.0', 'Descending (Type B Stanford) Aortic Dissection.PNG', 'Cropped to the axial image and a drawn circle removed')),
        'ct-lung-contusion': Object.assign({ modality: 'CT' }, C('James Heilman, MD', 'CC BY-SA 4.0', 'PulmonaryContusion2022.jpg', 'An arrow removed; resized')),
        'ct-retropharyngeal': Object.assign({ modality: 'CT' }, C('James Heilman, MD', 'CC BY-SA 4.0', 'LargeRetroAbsTra.png')),
        'ct-nec-fasc': Object.assign({ modality: 'CT' }, C('James Heilman, MD', 'CC BY-SA 4.0', 'Necrotising fascitis producing gas in soft tissues.jpg'))
    };
    Object.keys(IMAGES).forEach(k => { IMAGES[k].src = `images/investigations/${k}.jpg`; });
    // Ultrasound clips: a short silent animated WebP the room monitor plays in place of the still.
    const LOOPS = ['us-fast-positive', 'us-pleural-effusion', 'us-lung-sliding', 'us-ptx', 'us-ivc-collapse', 'us-consolidation', 'us-b-lines-confluent',
        'us-pericardial-effusion', 'us-ivc-plethoric', 'us-tamponade', 'us-rv-dilated', 'us-poor-lv', 'us-ivc-normal'];
    LOOPS.forEach(k => { IMAGES[k].loop = `images/investigations/${k}.webp`; });

    // ---- Findings: what the result says (and, where there is one, which image goes with it) --------
    // `label` is what the facilitator picks from; `report` is what the team sees.
    const F = (id, label, report, image) => ({ id, label, report, image: image || null });
    const FINDINGS = {
        'X-ray': [
            F('cxr-normal', 'Normal chest X-ray', 'Chest X-ray (PA): normal. Clear lung fields, normal heart size and mediastinum. No pneumothorax, consolidation or effusion.', 'cxr-normal'),
            F('cxr-ptx-tension', 'Tension pneumothorax (right)', 'Chest X-ray: large right pneumothorax. The right lung has collapsed towards the hilum, with no lung markings beyond it, and the mediastinum is shifted to the left. Small fluid level at the right base.', 'cxr-ptx-tension'),
            F('cxr-ptx-simple', 'Pneumothorax (right, no shift)', 'Chest X-ray: right pneumothorax. A visceral pleural edge is visible with no lung markings beyond it. No mediastinal shift.', 'cxr-ptx-simple'),
            F('cxr-ptx-spontaneous', 'Pneumothorax (left, moderate)', 'Chest X-ray: moderate left pneumothorax with partial collapse of the left lung and slight shift of the mediastinum to the right.', 'cxr-ptx-spontaneous'),
            F('cxr-pneumonia', 'Lobar pneumonia (right middle lobe)', 'Chest X-ray: right middle lobe consolidation. No pleural effusion or pneumothorax.', 'cxr-pneumonia'),
            F('cxr-pneumonia-2', 'Lobar pneumonia (right middle lobe, heart border lost)', 'Chest X-ray: right middle lobe consolidation obscuring the right heart border. No pleural effusion.', 'cxr-pneumonia-2'),
            F('cxr-rll', 'Right lower lobe consolidation', 'Chest X-ray: consolidation at the right base (right lower lobe), obscuring the right hemidiaphragm. In this patient, in keeping with aspiration pneumonia.', 'cxr-rll'),
            F('cxr-oedema', 'Acute pulmonary oedema', "Chest X-ray (AP): bilateral perihilar ('bat's wing') airspace shadowing in keeping with acute pulmonary oedema.", 'cxr-oedema'),
            F('cxr-oedema-shock', 'Pulmonary oedema (cardiogenic shock)', 'Chest X-ray (AP): bilateral diffuse airspace shadowing in keeping with pulmonary oedema. Lines and monitoring leads in place.', 'cxr-oedema-shock'),
            F('cxr-drowning', 'Bilateral aspiration / non-cardiogenic oedema', 'Chest X-ray: bilateral patchy airspace opacities, most marked in the mid and lower zones, in keeping with aspiration / non-cardiogenic pulmonary oedema.', 'cxr-drowning'),
            F('cxr-ards', 'ARDS (intubated)', 'Chest X-ray (AP, supine): diffuse bilateral airspace opacification. Endotracheal and orogastric tubes in place. In keeping with ARDS.', 'cxr-ards'),
            F('cxr-effusion', 'Large pleural effusion (left)', 'Chest X-ray: large left pleural effusion filling the lower two-thirds of the left hemithorax, with a meniscus at its upper edge.', 'cxr-effusion'),
            F('cxr-haemothorax', 'Haemothorax (left)', 'Chest X-ray: opacification of the left hemithorax. In the context of trauma, this is a large left haemothorax.', 'cxr-haemothorax'),
            F('cxr-free-air', 'Free air under the diaphragm', 'Chest X-ray (AP): a crescent of free gas under the right hemidiaphragm (pneumoperitoneum). In keeping with a perforated viscus.', 'cxr-free-air'),
            F('cxr-pneumomediastinum', 'Pneumomediastinum', 'Chest X-ray: pneumomediastinum. Lucent streaks outline the mediastinum and aortic arch, with gas tracking into the soft tissues of the neck.', 'cxr-pneumomediastinum'),
            F('cxr-copd', 'COPD (hyperexpanded)', 'Chest X-ray: hyperexpanded lungs with flattened hemidiaphragms and a narrow heart. No consolidation or pneumothorax.', 'cxr-copd'),
            F('cxr-pericardial-effusion', 'Large pericardial effusion', 'Chest X-ray: enlarged, globular cardiac silhouette with clear lung fields. Suggests a large pericardial effusion.', 'cxr-pericardial-effusion'),
            F('cxr-bronchiolitis', 'Bronchiolitis (infant)', 'Chest X-ray (infant): hyperinflated lungs with flattened diaphragms, and patchy atelectasis at the right apex and left base. In keeping with bronchiolitis.', 'cxr-bronchiolitis'),
            F('cxr-asthma', 'Asthma (hyperinflated)', 'Chest X-ray: hyperinflated lungs. No pneumothorax, pneumomediastinum or consolidation.'),
            F('cxr-pjp', 'PJP pneumonia', 'Chest X-ray: bilateral, fairly symmetrical hazy and fine reticular shadowing. No effusion. In an HIV-positive patient this suggests Pneumocystis (PJP) pneumonia.', 'cxr-pjp'),
            F('cxr-wide-mediastinum', 'Widened mediastinum (trauma)', 'Chest X-ray (supine): widened mediastinum with loss of the aortic knuckle and depression of the left main bronchus. Suspect traumatic aortic injury: CT aortogram.'),
            F('cxr-diaphragm', 'Diaphragmatic rupture', 'Chest X-ray: the nasogastric tube coils in the left chest and bowel loops are seen above the expected line of the left hemidiaphragm. Left diaphragmatic rupture.'),
            F('cxr-rib-fractures', 'Multiple rib fractures (no pneumothorax)', 'Chest X-ray: multiple rib fractures, including a segmental (flail) section. No pneumothorax or haemothorax on this film.'),
            F('cxr-rib-fractures-left', 'Multiple left rib fractures', 'Chest X-ray (erect): fractures of the left 2nd to 10th ribs, with marked displacement of the 5th to 7th ribs.', 'cxr-rib-fractures-left'),
            F('cxr-blast-lung', 'Blast lung', "Chest X-ray: bilateral perihilar ('butterfly') airspace shadowing in keeping with blast lung. No pneumothorax."),
            F('cxr-svco', 'Right upper mediastinal mass (SVCO)', 'Chest X-ray: widening of the right upper mediastinum from a mass next to the trachea. In a patient with lung cancer, in keeping with tumour causing SVC obstruction.', 'cxr-svco'),
            F('xr-neck-croup', 'Croup: steeple sign (neck X-ray)', 'AP neck X-ray (child): subglottic narrowing of the trachea (steeple sign). Croup is a clinical diagnosis; imaging is not needed.', 'xr-neck-croup'),
            F('xr-neck-epiglottitis', 'Epiglottitis: thumb sign (lateral neck)', "Lateral neck X-ray (soft tissue): swollen epiglottis (thumb sign). Do not delay airway management for imaging.", 'xr-neck-epiglottitis'),
            F('xr-button-battery', 'Button battery in oesophagus', 'Chest / neck X-ray: round radio-opaque foreign body in the upper oesophagus with a double-ring (halo) edge, the appearance of a button battery. Emergency removal.'),
            F('xr-fb-aspiration', 'Inhaled foreign body (air trapping)', 'Chest X-ray (inspiratory and expiratory): the right lung stays hyperinflated on expiration (air trapping) with the mediastinum shifting to the left. Suspect an inhaled foreign body in the right main bronchus.'),
            F('xr-nof', 'Fractured neck of femur (left)', 'Pelvis X-ray (AP): complete, partly displaced fracture of the left femoral neck, towards its lateral end (Garden III). The round marker is a calibration ball for implant planning.', 'xr-nof'),
            F('xr-supracondylar', 'Supracondylar fracture (child)', 'Elbow X-ray (lateral): displaced supracondylar fracture of the distal humerus.', 'xr-supracondylar'),
            F('axr-lbo', 'Large bowel obstruction (AXR)', 'Abdominal X-ray (supine): multiple dilated, gas-filled loops of bowel, in keeping with large bowel obstruction. Screws in the pelvis are from old orthopaedic surgery. CT to find the cause.', 'axr-lbo'),
            F('axr-sbo', 'Small bowel obstruction (AXR)', 'Abdominal X-ray: multiple dilated loops of small bowel in the central abdomen with little gas in the colon. Small bowel obstruction.'),
            F('axr-sbo-adult', 'Small bowel obstruction (adult AXR)', 'Abdominal X-ray (adult): multiple dilated loops of small bowel, with fluid levels. Small bowel obstruction.', 'axr-sbo-adult')
        ],
        'CT': [
            F('ct-normal-head', 'Normal CT head', 'CT head (non-contrast): no acute intracranial abnormality. No haemorrhage, mass effect or established infarct.', 'ct-normal-head'),
            F('ct-sah', 'Subarachnoid haemorrhage', 'CT head (non-contrast): hyperdense blood in the basal cisterns, extending into both Sylvian fissures. Acute subarachnoid haemorrhage.', 'ct-sah'),
            F('ct-dense-mca', 'Acute stroke: dense left MCA', 'CT head (non-contrast): hyperdense left middle cerebral artery (dense MCA sign), from acute thrombus. No haemorrhage.', 'ct-dense-mca'),
            F('ct-ich', 'Intracerebral haemorrhage (right)', 'CT head (non-contrast): large right basal ganglia intraparenchymal haemorrhage with surrounding oedema and mass effect, compressing the right lateral ventricle.', 'ct-ich'),
            F('ct-subdural', 'Acute subdural haematoma (left)', 'CT head (non-contrast): acute left subdural haematoma (crescent-shaped hyperdense collection over the left hemisphere) with mass effect, compression of the left lateral ventricle and midline shift to the right.', 'ct-subdural'),
            F('ct-subdural-chronic', 'Chronic subdural haematoma (left)', 'CT head (non-contrast): left chronic subdural haematoma: crescent-shaped collection over the left hemisphere, mostly darker than brain with some brighter areas of more recent bleeding. Mass effect with slight midline shift to the right.'),
            F('ct-edh', 'Extradural haematoma (right)', 'CT head (non-contrast): large right frontoparietal extradural haematoma (convex hyperdense collection) with mass effect and early subfalcine herniation.', 'ct-edh'),
            F('ct-hydrocephalus', 'Hydrocephalus', 'CT head (non-contrast): dilated lateral ventricles. Hydrocephalus.', 'ct-hydrocephalus'),
            F('ct-pe', 'Pulmonary embolism (CTPA)', 'CT pulmonary angiogram: large central filling defects straddling the main pulmonary arteries (saddle embolus). The left main pulmonary artery is almost completely occluded.', 'ct-pe'),
            F('ct-pancreatitis', 'Acute pancreatitis', 'CT abdomen (contrast): swollen pancreas with extensive peripancreatic fluid and fat stranding. Acute pancreatitis.', 'ct-pancreatitis'),
            F('ct-spleen', 'Splenic rupture', 'CT abdomen (contrast, portal venous phase): splenic rupture with a subcapsular haematoma. Bilateral pleural effusions.', 'ct-spleen'),
            F('ct-cerebellar', 'Cerebellar infarct (left)', 'CT head: low density in the left cerebellar hemisphere. Posterior circulation (cerebellar) infarct, here from vertebral artery occlusion; watch for swelling and hydrocephalus. MRI recommended.', 'ct-cerebellar'),
            F('ct-aaa', 'Ruptured AAA', 'CT abdomen: large abdominal aortic aneurysm with a calcified wall, and haematoma in the left retroperitoneum beside it. Ruptured AAA.', 'ct-aaa'),
            F('ct-dissection', 'Aortic dissection (type A)', 'CT aorta: intimal flap from the ascending aorta to the iliac bifurcation. Stanford type A dissection.'),
            F('ct-dissection-b', 'Aortic dissection (type B)', 'CT chest (contrast): an intimal flap in the descending thoracic aorta, with the ascending aorta spared. Stanford type B dissection.', 'ct-dissection-b'),
            F('ct-aortic-injury', 'Traumatic aortic injury', 'CT aortogram: contained rupture of the aortic isthmus with a pseudoaneurysm and mediastinal haematoma.'),
            F('ct-perforation', 'Perforated viscus', 'CT abdomen: free intraperitoneal gas collecting under the anterior abdominal wall, in front of the liver. Perforated viscus.', 'ct-perforation'),
            F('ct-mesenteric', 'Mesenteric ischaemia', 'CT mesenteric angiogram: occlusion of the superior mesenteric artery with thin-walled, poorly enhancing small bowel and pneumatosis. Acute mesenteric ischaemia.'),
            F('ct-kub-stone', 'Obstructing ureteric stone (right)', 'CT KUB (non-contrast): a stone in the right proximal ureter, with mild obstruction and hydronephrosis of the right kidney.', 'ct-kub-stone'),
            F('ct-lbo', 'Large bowel obstruction (CT)', 'CT abdomen: obstructing sigmoid tumour with a dilated colon proximally (caecum 11 cm). No free gas.'),
            F('ct-pituitary', 'Pituitary apoplexy', 'CT head: hyperdense, enlarged pituitary mass extending above the sella. Pituitary apoplexy; MRI recommended.'),
            F('ct-hsv', 'HSV encephalitis', 'CT head: subtle low density in the left medial temporal lobe. MRI: high signal in the left temporal lobe and insula, typical of HSV encephalitis.'),
            F('ct-vad', 'Vertebral artery dissection', 'CT angiogram: tapering narrowing of the left vertebral artery (dissection), with a small left cerebellar infarct.'),
            F('ct-cord', 'Spinal cord compression (MRI)', 'MRI whole spine: metastatic collapse of T8 with epidural tumour compressing the spinal cord.'),
            F('ct-orbit', 'Retrobulbar haematoma', 'CT orbits: retrobulbar haematoma with proptosis and stretching of the optic nerve (tenting of the globe).'),
            F('ct-face', 'Maxillofacial fractures', 'CT face: bilateral Le Fort II fractures with comminuted nasal bones and blood in the maxillary sinuses.'),
            F('ct-neck-abscess', 'Deep neck infection', 'CT neck (contrast): floor-of-mouth cellulitis with a submandibular collection and narrowing of the airway.'),
            F('ct-retropharyngeal', 'Retropharyngeal abscess', 'CT neck (axial): a large low-density collection behind the pharynx, narrowing the airway. Retropharyngeal abscess.', 'ct-retropharyngeal'),
            F('ct-nec-fasc', 'Necrotising fasciitis', 'CT abdomen: gas in the soft tissues of the right flank and abdominal wall. In keeping with necrotising fasciitis: urgent surgical debridement.', 'ct-nec-fasc'),
            F('ct-lung-contusion', 'Pulmonary contusion (left)', 'CT chest (lung window): patchy airspace shadowing in the anterior left lung after blunt trauma. Pulmonary contusion.', 'ct-lung-contusion'),
            F('ct-nai', 'Subdural haematomas (consider NAI)', 'CT head: thin subdural collections of differing densities over both hemispheres. Consider non-accidental injury: skeletal survey and safeguarding referral.'),
            F('ct-paeds-edh', 'Extradural haematoma (child)', 'CT head: biconvex extradural haematoma under a temporal skull fracture, with mass effect.')
        ],
        'ECG': [
            F('ecg-stemi-anterior', 'Anterior STEMI', '12-lead ECG: sinus tachycardia about 115/min. ST elevation V2–V5, I and aVL, with reciprocal ST depression in III and aVF: acute anterolateral STEMI. Left anterior fascicular block.', 'ecg-stemi-anterior'),
            F('ecg-stemi-anterior-2', 'Anterior STEMI (2)', '12-lead ECG: sinus rhythm about 90/min. ST elevation in V2–V5, greatest in V3: acute anterior STEMI.', 'ecg-stemi-anterior-2'),
            F('ecg-stemi-inferior', 'Inferior STEMI', '12-lead ECG: sinus rhythm about 100/min. ST elevation in II, III and aVF with reciprocal ST depression: acute inferior STEMI.', 'ecg-stemi-inferior'),
            F('ecg-hyperkalaemia', 'Severe hyperkalaemia', '12-lead ECG: broad complex rhythm about 120/min, with no clear P waves and peaked T waves. Severe hyperkalaemia (pre-arrest pattern).', 'ecg-hyperkalaemia'),
            F('ecg-pe', 'PE: S1Q3T3', '12-lead ECG: sinus tachycardia about 100/min. Deep S wave in I, Q wave and inverted T wave in III (S1Q3T3).', 'ecg-pe'),
            F('ecg-chb', 'Complete heart block', '12-lead ECG: complete (third-degree) heart block. P waves march through independently of a slow, regular escape rhythm.', 'ecg-chb'),
            F('ecg-brugada', 'Brugada type 1', '12-lead ECG: coved ST elevation with T-wave inversion in V1–V2. Brugada type 1 pattern.', 'ecg-brugada'),
            F('ecg-alternans', 'Low voltage with electrical alternans', '12-lead ECG: sinus tachycardia with low-voltage QRS complexes and electrical alternans (QRS amplitude changing beat to beat).', 'ecg-alternans'),
            F('ecg-wellens', 'Wellens pattern', '12-lead ECG (pain-free): sinus rhythm about 55/min. Deep, symmetrical T-wave inversion V3–V6 with a biphasic T wave in V2. Wellens pattern (critical proximal LAD stenosis).', 'ecg-wellens'),
            F('ecg-lvh', 'LVH with strain', '12-lead ECG: sinus rhythm. Very large QRS voltages with lateral ST depression and T-wave inversion. Left ventricular hypertrophy with strain.', 'ecg-lvh'),
            F('ecg-long-qt', 'Long QT', '12-lead ECG: sinus rhythm about 60/min. Markedly prolonged QT interval with broad T waves.', 'ecg-long-qt')
        ],
        'POCUS': [
            // FAST and abdomen
            F('us-fast-positive', 'FAST: free fluid (Morison\'s pouch)', "FAST (right upper quadrant): free fluid, a dark stripe between the liver and the right kidney (Morison's pouch). In this trauma patient, presumed haemoperitoneum.", 'us-fast-positive'),
            F('us-fast-positive-2', 'FAST: free fluid (Morison\'s pouch, 2)', "FAST (right upper quadrant): free fluid between the liver and the right kidney (Morison's pouch).", 'us-fast-positive-2'),
            F('us-fast-negative', 'FAST: no free fluid (Morison\'s pouch)', "FAST (right upper quadrant): liver and right kidney in contact, with no free fluid in Morison's pouch.", 'us-fast-negative'),
            F('us-aaa', 'Aorta: AAA (transverse)', 'Ultrasound aorta (transverse): abdominal aortic aneurysm. Ultrasound cannot exclude rupture: in an unstable patient, go straight to theatre.', 'us-aaa'),
            F('us-aaa-long', 'Aorta: AAA (longitudinal)', 'Ultrasound aorta (longitudinal): abdominal aortic aneurysm. Ultrasound cannot exclude rupture: in an unstable patient, go straight to theatre.', 'us-aaa-long'),
            F('us-aorta-normal', 'Aorta: normal calibre', 'Ultrasound aorta (transverse): normal calibre abdominal aorta. No aneurysm.', 'us-aorta-normal'),
            F('us-gallstones', 'Gallstones (no cholecystitis)', 'Ultrasound gallbladder: gallstones with acoustic shadowing and some sludge. No pericholecystic fluid.', 'us-gallstones'),
            F('us-cholecystitis', 'Acute cholecystitis', 'Ultrasound gallbladder: gallstones, a thickened gallbladder wall and pericholecystic fluid. Acute cholecystitis.', 'us-cholecystitis'),
            F('us-cbd', 'Dilated bile duct', 'Ultrasound: gallstones with a dilated common bile duct (11 mm) and intrahepatic duct dilatation.'),
            F('us-hydronephrosis', 'Hydronephrosis', 'Ultrasound: right hydronephrosis with a dilated renal pelvis and calyces.'),
            F('us-bladder', 'Large bladder (retention)', 'Bladder ultrasound: distended bladder, estimated volume 1.4 litres. Bilateral mild hydronephrosis.'),
            F('us-bladder-trabeculated', 'Bladder: trabeculated wall', 'Bladder ultrasound: a full bladder with a thick, trabeculated wall, a sign of long-standing outflow obstruction and retention.', 'us-bladder-trabeculated'),
            F('us-ectopic', 'Ectopic pregnancy', "Pelvic ultrasound: empty uterus with free fluid in the pouch of Douglas and Morison's pouch. With a positive pregnancy test, ruptured ectopic pregnancy."),
            F('us-ovarian-torsion', 'Ovarian torsion', 'Pelvic ultrasound: enlarged right ovary with peripheral follicles and reduced Doppler flow. Suspected ovarian torsion.'),
            F('us-intussusception', 'Intussusception (target sign)', 'Ultrasound abdomen (child): target (doughnut) sign, rings of bowel wall within bowel. Intussusception.', 'us-intussusception'),
            F('us-pyloric', 'Pyloric stenosis', 'Ultrasound abdomen (infant): thickened, elongated pylorus. Pyloric stenosis.', 'us-pyloric'),
            F('us-torsion', 'Testicular torsion', 'Testicular ultrasound with colour Doppler: no blood flow in the affected testis. Testicular torsion. Do not delay surgery for imaging.', 'us-torsion'),
            // Lungs
            F('us-lung-sliding', 'Lung: normal sliding', 'Lung ultrasound (anterior chest): the pleural line slides to and fro with breathing (lung sliding). No pneumothorax at this point.', 'us-lung-sliding'),
            F('us-seashore', 'Lung M-mode: seashore sign', 'Lung ultrasound, M-mode: seashore sign (straight lines above the pleural line, a grainy pattern below it). The lung is sliding at this point, so no pneumothorax here.', 'us-seashore'),
            F('us-ptx', 'Lung: no sliding (pneumothorax)', 'Lung ultrasound: no lung sliding at the pleural line on the affected side. Suggests pneumothorax.', 'us-ptx'),
            F('us-b-lines', 'Lung: B-lines', "Lung ultrasound (one right-sided zone shown): multiple B-lines, vertical artefacts running from the pleural line to the bottom of the screen, some merging. Similar in both lungs. Interstitial fluid, e.g. pulmonary oedema.", 'us-b-lines'),
            F('us-b-lines-confluent', 'Lung: confluent B-lines', 'Lung ultrasound (left anterior chest): confluent B-lines running down from the pleural line. Interstitial pattern, e.g. viral pneumonitis or pulmonary oedema.', 'us-b-lines-confluent'),
            F('us-consolidation', 'Lung: consolidation', 'Lung ultrasound: consolidated lung that looks like liver tissue (hepatisation). In keeping with pneumonia.', 'us-consolidation'),
            F('us-pleural-effusion', 'Lung: large pleural effusion', 'Lung ultrasound: a large dark (anechoic) pleural collection. Large pleural effusion (in trauma, presume haemothorax).', 'us-pleural-effusion'),
            // Heart and IVC
            F('us-echo-a4c', 'Echo: apical four-chamber, no obvious abnormality', 'Echo (apical four-chamber): all four chambers seen. Right ventricle smaller than the left, and no pericardial effusion seen.', 'us-echo-a4c'),
            F('us-pericardial-effusion', 'Echo: large pericardial effusion', 'Echo (subcostal): a large pericardial effusion surrounding the heart, which swings within it.', 'us-pericardial-effusion'),
            F('us-tamponade', 'Pericardial effusion with tamponade', 'Echo (apical four-chamber): pericardial effusion with the right atrium collapsing in systole. Tamponade.', 'us-tamponade'),
            F('us-rv-dilated', 'Echo: dilated RV with clot in transit', 'Echo (apical four-chamber): markedly dilated right ventricle with the septum bowing into the left ventricle (right heart strain), and a mobile thrombus crossing the tricuspid valve. In keeping with massive PE.', 'us-rv-dilated'),
            F('us-poor-lv', 'Echo: poor LV function', 'Echo (parasternal long axis): mildly dilated left ventricle with globally poor systolic function.', 'us-poor-lv'),
            F('us-ivc-normal', 'IVC: normal, varies with breathing', 'IVC ultrasound (subcostal): normal size, varying with breathing.', 'us-ivc-normal'),
            F('us-ivc-collapse', 'IVC: collapsing (hypovolaemia)', 'IVC ultrasound (subcostal): the IVC collapses completely with breathing. Suggests hypovolaemia.', 'us-ivc-collapse'),
            F('us-ivc-plethoric', 'IVC: plethoric', 'IVC ultrasound (subcostal): large IVC that hardly changes with breathing. Raised right atrial pressure, e.g. tamponade, massive PE or fluid overload.', 'us-ivc-plethoric'),
            // Other
            F('us-dvt', 'DVT: left common femoral vein', 'Venous ultrasound (left groin): echogenic thrombus within the left common femoral vein. Deep vein thrombosis.', 'us-dvt'),
            F('us-retinal-detachment', 'Eye: retinal detachment', 'Ocular ultrasound: a bright membrane lifted off the back of the globe, tethered at the optic disc. Retinal detachment.', 'us-retinal-detachment')
        ]
    };
    const byId = {};
    Object.keys(FINDINGS).forEach(type => FINDINGS[type].forEach(f => { byId[f.id] = Object.assign({}, f, { type }); }));

    // ---- Each scenario's own results (scenario id -> finding id per investigation) ----------------
    // Only where the scenario has an abnormal (or specifically illustrated) result; everything else
    // keeps its existing result. ECG entries add a real 12-lead image to the scenario's own ECG text.
    const SCENARIO_RESULTS = {
        AM001: { ECG: 'ecg-stemi-anterior-2' },   // about 90/min, as the scenario
        AM002: { 'X-ray': 'cxr-pneumonia' },
        AM003: { 'X-ray': 'cxr-asthma' },
        // AM004 (hyperkalaemia) keeps its drawn 12-lead: it is a broad complex BRADYCARDIA, and the real
        // hyperkalaemia ECG runs at about 120/min. That ECG stays in the library for the facilitator.
        AM011: { 'X-ray': 'cxr-oedema', POCUS: 'us-b-lines' },
        AM012: { 'X-ray': 'cxr-copd' },
        AM015: { ECG: 'ecg-pe', CT: 'ct-pe', POCUS: 'us-rv-dilated' },
        AM020: { CT: 'ct-sah' },
        AM021: { CT: 'ct-dense-mca' },
        AM023: { ECG: 'ecg-chb' },
        AM027: { CT: 'ct-dissection' },
        AM029: { POCUS: 'us-cbd' },
        AM030: { 'X-ray': 'cxr-pneumonia-2' },
        AM031: { 'X-ray': 'cxr-ptx-tension', POCUS: 'us-ptx' },
        AM034: { 'X-ray': 'cxr-pneumomediastinum' },
        AM039: { 'X-ray': 'cxr-pericardial-effusion', ECG: 'ecg-alternans', POCUS: 'us-tamponade' },
        AM040: { ECG: 'ecg-wellens' },
        AM042: { ECG: 'ecg-brugada' },
        AM044: { CT: 'ct-vad' },
        AM046: { CT: 'ct-pituitary' },
        AM047: { CT: 'ct-neck-abscess' },
        AM049: { CT: 'ct-nec-fasc' },
        AM050: { CT: 'ct-pancreatitis' },
        AM054: { ECG: 'ecg-lvh' },
        AM059: { 'X-ray': 'xr-neck-epiglottitis' },
        AM061: { 'X-ray': 'cxr-pjp' },
        AM064: { CT: 'ct-ich' },
        AM065: { CT: 'ct-normal-head' },
        AM066: { 'X-ray': 'cxr-oedema-shock', ECG: 'ecg-stemi-anterior', POCUS: 'us-poor-lv' },   // tachycardic, Q waves V1–V3
        AM068: { CT: 'ct-normal-head' },
        AM069: { 'X-ray': 'cxr-svco' },
        AM072: { 'X-ray': 'cxr-free-air', CT: 'ct-perforation' },
        AM073: { CT: 'ct-kub-stone', POCUS: 'us-hydronephrosis' },
        AM075: { CT: 'ct-cord' },
        AM076: { 'X-ray': 'cxr-pneumonia' },
        AM081: { CT: 'ct-hsv' },
        AM084: { 'X-ray': 'cxr-ptx-spontaneous', POCUS: 'us-ptx' },
        AM085: { 'X-ray': 'cxr-drowning' },
        TX011: { 'X-ray': 'cxr-drowning' },
        AT002: { 'X-ray': 'cxr-ptx-tension', POCUS: 'us-ptx' },   // stabbed in the right chest; tension
        AT003: { CT: 'ct-edh' },
        AT006: { 'X-ray': 'cxr-rib-fractures-left' },   // kicked by a horse: displaced left rib fractures
        AT013: { 'X-ray': 'cxr-ptx-simple', POCUS: 'us-ptx' },
        AT014: { 'X-ray': 'cxr-blast-lung' },
        AT015: { 'X-ray': 'cxr-wide-mediastinum', CT: 'ct-aortic-injury' },
        AT016: { 'X-ray': 'cxr-diaphragm' },
        AT017: { CT: 'ct-orbit' },
        AT022: { CT: 'ct-face' },
        AT025: { CT: 'ct-spleen', POCUS: 'us-fast-positive' },
        AT001: { POCUS: 'us-fast-positive' },
        AT024: { POCUS: 'us-fast-positive' },
        PT003: { POCUS: 'us-fast-positive' },
        PT005: { POCUS: 'us-fast-positive' },
        AT026: { POCUS: 'us-fast-positive' },   // stabbed abdomen in haemorrhagic shock (not a pneumothorax)
        PT006: { POCUS: 'us-fast-positive' },   // left flank stab in haemorrhagic shock
        AT031: { ECG: 'ecg-long-qt' },
        EL001: { 'X-ray': 'xr-nof' },
        EL003: { CT: 'ct-subdural-chronic' },   // chronic: the acute (bright) image would be wrong
        ET003: { CT: 'ct-subdural' },
        EL004: { CT: 'ct-aaa', POCUS: 'us-aaa' },
        EL006: { CT: 'ct-mesenteric' },
        EL008: { 'X-ray': 'cxr-rll' },
        EL009: { 'X-ray': 'axr-lbo', CT: 'ct-lbo' },
        EL010: { CT: 'ct-cerebellar' },
        EL013: { POCUS: 'us-bladder' },
        ET002: { 'X-ray': 'cxr-rib-fractures' },
        OB003: { POCUS: 'us-ectopic' },
        OB007: { POCUS: 'us-ovarian-torsion' },
        OB008: { 'X-ray': 'cxr-oedema', POCUS: 'us-poor-lv' },
        OB021: { ECG: 'ecg-pe', CT: 'ct-pe', POCUS: 'us-rv-dilated' },
        PA002: { 'X-ray': 'xr-neck-croup' },
        PA005: { 'X-ray': 'cxr-bronchiolitis' },
        PA008: { POCUS: 'us-intussusception' },
        PA009: { 'X-ray': 'xr-button-battery' },
        PA013: { 'X-ray': 'xr-fb-aspiration' },
        PA014: { POCUS: 'us-torsion' },
        PA016: { POCUS: 'us-pyloric' },
        PA017: { 'X-ray': 'axr-sbo' },
        PA022: { 'X-ray': 'xr-supracondylar' },
        PA032: { CT: 'ct-hydrocephalus' },
        PA035: { ECG: 'ecg-long-qt' },
        PT001: { CT: 'ct-nai' },
        PT002: { CT: 'ct-paeds-edh' }
    };

    // The scenario investigations key for each result type (scenario.investigations.<key>).
    const KEY = { 'X-ray': 'chestXray', CT: 'ct', ECG: 'ecg', POCUS: 'pocus' };

    // A finding as the investigations block stores it: { findings, image } (POCUS as text too).
    const asResult = (id) => {
        const f = byId[id];
        return f ? { findings: f.report, image: f.image || null, findingId: f.id } : null;
    };

    // Apply a scenario's own results to its generated investigations block (called by enrichScenario).
    const applyScenarioResults = (scenarioId, investigations) => {
        const map = SCENARIO_RESULTS[scenarioId];
        if (!map || !investigations) return investigations;
        const out = Object.assign({}, investigations);
        Object.keys(map).forEach(type => {
            const r = asResult(map[type]);
            if (!r) return;
            const key = KEY[type];
            if (type === 'ECG') {
                // Keep the scenario's own ECG type and wording; add the real 12-lead image.
                out.ecg = Object.assign({}, out.ecg, { image: r.image, imageReport: r.findings, findingId: r.findingId });
            } else {
                out[key] = r;
            }
        });
        return out;
    };

    // The image that should go with a result, if any: an explicit key, or the scenario's own.
    // Course images (keys 'course:<id>') are not shipped: they are read from the database at run
    // time by whoever may see them, and registered here so every screen can show them the same way.
    const COURSE_IMAGES = {};
    const registerImage = (key, img) => {
        if (typeof key !== 'string' || !key.startsWith('course:') || !img || typeof img.src !== 'string') return;
        COURSE_IMAGES[key] = { src: img.src, modality: img.modality || '', credit: String(img.credit || '') };
    };
    const imageFor = (key) => (key && IMAGES[key]) ? IMAGES[key] : (key && COURSE_IMAGES[key]) ? COURSE_IMAGES[key] : null;
    // A real ECG image is only used while the patient's rhythm is one it can stand for.
    const ecgImageFits = (key, rhythm) => {
        const img = imageFor(key);
        if (!img || img.modality !== 'ECG') return false;
        const R = window.RHYTHMS;
        const r = R ? R.canonical(rhythm || 'Sinus Rhythm') : rhythm;
        return !img.rhythms || img.rhythms.indexOf(r) !== -1;
    };
    const creditText = (img) => !img ? '' : img.credit ? img.credit : `${img.author}, ${img.licence}, via Wikimedia Commons${img.modified && img.modified !== 'Resized' ? ` (${img.modified.toLowerCase()})` : ''}`;

    // ---- The facilitator's own results for this run ------------------------------------------------
    // What each investigation button on the room monitor returns can be changed by the facilitator,
    // before START or during the run. The choice is written into the scenario's own result fields
    // (top level and scenario.investigations, the same places the sync payload and the monitor
    // already read), so the monitor, the "Scenario finding" send and a resumed run all agree.
    // The scenario's original fields are kept in scenario.invDefaults so "Back to the scenario's
    // own result" can restore them, and scenario.invChanged says what was chosen (for the label).
    //
    // A choice ("spec") is one of:
    //   { findingId }            a library finding (with its image, if it has one)
    //   { text }                 the facilitator's own written report
    //   { vbg: {pH, pCO2, ...} } (VBG) the gas the team gets; it still drifts with treatment
    //   { urine: 'uti' }         (Urine) a dipstick preset from generateUrine
    //   { pocus: 'normal' }      (POCUS) a preset from generatePocus
    //   { ecgLive: true }        (ECG) no real image: the 12-lead is drawn from the live rhythm
    const RESULT_TYPES = ['ECG', 'VBG', 'X-ray', 'Urine', 'POCUS', 'CT'];
    const FIELD = { 'X-ray': 'chestXray', CT: 'ct', POCUS: 'pocus', Urine: 'urine', ECG: 'ecg', VBG: 'vbg' };
    // What the room monitor shows when a scenario has no result of that type at all.
    const FALLBACK = { ECG: 'Drawn from the live rhythm.', 'X-ray': 'Lung fields clear.', CT: 'No acute intracranial pathology.', Urine: 'Urinalysis Normal.', POCUS: 'No free fluid seen.' };
    const URINE_PRESETS = [
        { id: 'normal', label: 'Normal dipstick' }, { id: 'uti', label: 'UTI (leucocytes, nitrites)' }, { id: 'dka', label: 'DKA (ketones, glucose)' },
        { id: 'hhs', label: 'HHS (glucose, trace ketones)' }, { id: 'rhabdo', label: 'Rhabdomyolysis (blood: myoglobin)' },
        { id: 'pregnancy', label: 'Pregnancy test positive' }, { id: 'renal_colic', label: 'Renal colic (blood)' }
    ];
    const POCUS_PRESETS = [
        { id: 'normal', label: 'Normal (heart, lungs, FAST)' }, { id: 'tamponade', label: 'Tamponade' }, { id: 'pneumothorax', label: 'Pneumothorax (left)' }
    ];
    const VBG_PRESETS = [
        { id: 'normal', label: 'Normal' }, { id: 'dka_severe', label: 'Severe DKA' }, { id: 'hhs', label: 'HHS' },
        { id: 'septic_shock', label: 'Septic shock' }, { id: 'haemorrhagic_shock', label: 'Haemorrhagic shock' },
        { id: 'copd_retainer', label: 'COPD (chronic CO2 retainer)' }, { id: 'respiratory_acidosis_acute', label: 'Acute respiratory acidosis' },
        { id: 'metabolic_acidosis_severe', label: 'Severe metabolic acidosis' }, { id: 'metabolic_alkalosis', label: 'Metabolic alkalosis' },
        { id: 'hyperkalemia', label: 'Hyperkalaemia' }, { id: 'hyponatremia', label: 'Hyponatraemia' }, { id: 'gi_bleed', label: 'GI bleed' },
        { id: 'hypercalcemia', label: 'Hypercalcaemia' }, { id: 'hypothermia', label: 'Hypothermia' }, { id: 'co_poisoning', label: 'Carbon monoxide poisoning' }
    ];
    // The VBG values the facilitator can type, with the limits the editor accepts.
    const VBG_FIELDS = [
        { k: 'pH', label: 'pH', min: 6.5, max: 7.9, step: 0.01 }, { k: 'pCO2', label: 'pCO2 (kPa)', min: 1, max: 20, step: 0.1 },
        { k: 'pO2', label: 'pO2 (kPa)', min: 1, max: 70, step: 0.1 }, { k: 'HCO3', label: 'HCO3 (mmol/L)', min: 1, max: 60, step: 1 },
        { k: 'BE', label: 'BE', min: -35, max: 35, step: 1 }, { k: 'Lac', label: 'Lactate (mmol/L)', min: 0, max: 30, step: 0.1 },
        { k: 'K', label: 'K+ (mmol/L)', min: 1, max: 10, step: 0.1 }, { k: 'Glu', label: 'Glucose (mmol/L)', min: 0.5, max: 60, step: 0.1 },
        { k: 'Na', label: 'Na+ (mmol/L, optional)', min: 100, max: 180, step: 1, optional: true },
        { k: 'Ca', label: 'Ionised Ca2+ (mmol/L, optional)', min: 0.3, max: 3, step: 0.01, optional: true }
    ];
    const vbgSummary = (v) => !v ? '' : `pH ${Number(v.pH).toFixed(2)}, pCO2 ${Number(v.pCO2).toFixed(1)}, lactate ${Number(v.Lac).toFixed(1)}, K+ ${Number(v.K).toFixed(1)}, glucose ${Number(v.Glu).toFixed(1)}`;
    const urineText = (u) => {
        const labels = { leuks: 'Leucocytes', nitrites: 'Nitrites', blood: 'Blood', ketones: 'Ketones', protein: 'Protein', glucose: 'Glucose', bhcg: 'B-hCG' };
        return Object.keys(labels).filter(k => u[k] !== undefined).map(k => `${labels[k]}: ${u[k]}`).join(', ');
    };
    const pocusText = (p) => ['heart', 'lungs', 'abdo', 'aorta', 'ivc'].filter(k => p[k]).map(k => p[k]).join(' ');
    const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined && o[k] !== null;

    // A label for a choice, as the controller lists it.
    const specLabel = (type, spec) => {
        if (!spec) return '';
        if (spec.findingId && byId[spec.findingId]) return byId[spec.findingId].label;
        if (spec.text) return 'Your own report';
        if (spec.ecgLive) return 'Drawn from the live rhythm';
        if (spec.urine) { const p = URINE_PRESETS.filter(x => x.id === spec.urine)[0]; return p ? p.label : spec.urine; }
        if (spec.pocus) { const p = POCUS_PRESETS.filter(x => x.id === spec.pocus)[0]; return p ? p.label : spec.pocus; }
        if (spec.vbg) return spec.preset ? ((VBG_PRESETS.filter(x => x.id === spec.preset)[0] || {}).label || 'Your values') : 'Your values';
        return '';
    };

    // A clean VBG from typed values: every field the monitor's grid prints must be a finite number.
    const cleanVbg = (v, base) => {
        const out = Object.assign({}, base || {});
        VBG_FIELDS.forEach(f => {
            const n = Number(v && v[f.k]);
            if (v && v[f.k] !== '' && v[f.k] !== null && v[f.k] !== undefined && Number.isFinite(n)) out[f.k] = Math.min(f.max, Math.max(f.min, n));
            else if (f.optional) delete out[f.k];
        });
        ['pH', 'pCO2', 'pO2', 'HCO3', 'BE', 'Lac', 'K', 'Glu'].forEach(k => { if (!Number.isFinite(Number(out[k]))) out[k] = ({ pH: 7.4, pCO2: 5.3, pO2: 5.0, HCO3: 24, BE: 0, Lac: 1.0, K: 4.0, Glu: 5.5 })[k]; });
        if (!Number.isFinite(Number(out.Ketones))) out.Ketones = 0.2;
        return out;
    };

    // Apply a choice (or, with spec null, restore the scenario's own result). Returns a NEW scenario.
    const setResult = (scenario, type, spec) => {
        const f = FIELD[type];
        if (!scenario || !f) return scenario;
        const out = Object.assign({}, scenario);
        const inv = Object.assign({}, scenario.investigations || {});
        const defaults = Object.assign({}, scenario.invDefaults || {});
        const changed = Object.assign({}, scenario.invChanged || {});
        const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
        if (!defaults[type]) defaults[type] = { top: has(scenario, f) ? scenario[f] : null, gen: has(inv, f) ? inv[f] : null, topKey: own(scenario, f), genKey: own(inv, f) };
        const d = defaults[type];
        // Put back exactly what was there: a value, a null, or no key at all.
        const put = (obj, k, v, hadKey) => { if (v !== null && v !== undefined) obj[k] = v; else if (hadKey) obj[k] = null; else delete obj[k]; };
        if (!spec) {
            if (type !== 'ECG') put(out, f, d.top, d.topKey);
            put(inv, f, d.gen, d.genKey);
            delete defaults[type]; delete changed[type];
        } else if (type === 'ECG') {
            const fd = spec.findingId ? byId[spec.findingId] : null;
            const base = Object.assign({}, d.gen || d.top || scenario.ecg || {});
            base.image = fd ? fd.image : null;
            base.imageReport = fd ? fd.report : null;
            base.findingId = fd ? fd.id : null;
            inv.ecg = base;
            changed[type] = Object.assign({ label: specLabel(type, spec) }, spec);
        } else {
            let block = null;
            if (type === 'VBG') {
                const start = spec.vbg || (spec.preset && window.generateVbg ? window.generateVbg(spec.preset) : null);
                block = cleanVbg(start, null);
            } else if (spec.findingId && byId[spec.findingId]) {
                block = asResult(spec.findingId);
            } else if (spec.urine && window.generateUrine) {
                block = window.generateUrine(spec.urine);
            } else if (spec.pocus && window.generatePocus) {
                block = window.generatePocus(spec.pocus);
            } else if (spec.text) {
                block = { findings: String(spec.text).slice(0, 2000), image: null, findingId: null };
            }
            if (!block) return scenario;
            out[f] = block;
            inv[f] = block;
            const keep = Object.assign({ label: specLabel(type, spec) }, spec);
            if (type === 'VBG') { keep.vbg = block; }
            changed[type] = keep;
        }
        // What scenario.investigations was before the first change (Quick Sim has none), so undoing
        // every change leaves the scenario exactly as it was.
        const shape = scenario.invShape || (scenario.investigations === null ? 'null' : own(scenario, 'investigations') ? 'obj' : 'none');
        out.investigations = inv;
        out.invDefaults = defaults;
        out.invChanged = changed;
        out.invShape = shape;
        if (!Object.keys(changed).length) {
            if (!Object.keys(inv).length && shape === 'null') out.investigations = null;
            else if (!Object.keys(inv).length && shape === 'none') delete out.investigations;
            delete out.invDefaults; delete out.invChanged; delete out.invShape;
        }
        return out;
    };

    // What the monitor button for this type will give right now: { text, image, changed, label,
    // ecgImageNotFitting }. Mirrors how the room monitor resolves a result.
    const currentResult = (scenario, type, rhythm) => {
        const f = FIELD[type];
        const spec = scenario && scenario.invChanged ? scenario.invChanged[type] : null;
        const res = { text: null, image: null, changed: !!spec, label: spec ? (spec.label || specLabel(type, spec)) : '', ecgImageNotFitting: false };
        if (!scenario || !f) return res;
        const top = scenario[f], gen = (scenario.investigations || {})[f];
        const src = (type === 'ECG') ? (gen || top) : ((top && (typeof top === 'string' || top.findings || top.image || Object.keys(top).length)) ? top : gen);
        if (type === 'VBG') { res.text = vbgSummary(src || (window.generateVbg ? window.generateVbg('normal') : null)); return res; }
        if (type === 'ECG') {
            if (src && src.image) {
                if (ecgImageFits(src.image, rhythm)) { res.image = src.image; res.text = src.imageReport || src.findings || null; }
                else res.ecgImageNotFitting = true;
            }
            if (!res.image) res.text = FALLBACK.ECG;
            return res;
        }
        if (src) {
            res.text = typeof src === 'string' ? src : (src.findings || (type === 'Urine' ? urineText(src) : type === 'POCUS' ? pocusText(src) : null));
            res.image = (typeof src === 'object' && src.image && imageFor(src.image)) ? src.image : null;
        }
        if (!res.text && !res.image) res.text = FALLBACK[type];
        return res;
    };

    // The Builder stores choices as scenario.invResults ({ type: spec }); apply them at run time.
    const applyResultSpecs = (scenario, specs) => {
        if (!scenario || !specs || typeof specs !== 'object') return scenario;
        let out = scenario;
        RESULT_TYPES.forEach(t => { if (specs[t]) out = setResult(out, t, specs[t]); });
        return out;
    };

    window.INVESTIGATIONS = { IMAGES, FINDINGS, SCENARIO_RESULTS, byId, asResult, applyScenarioResults, imageFor, registerImage, ecgImageFits, creditText, KEY,
        RESULT_TYPES, FIELD, URINE_PRESETS, POCUS_PRESETS, VBG_PRESETS, VBG_FIELDS, setResult, currentResult, applyResultSpecs, specLabel, cleanVbg, vbgSummary };
})();
