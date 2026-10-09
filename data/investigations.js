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
        'cxr-normal': { modality: 'X-ray', ...C('Mikael Häggström', 'CC0', 'Normal posteroanterior (PA) chest radiograph (X-ray).jpg') },
        'cxr-ptx-tension': { modality: 'X-ray', ...C('Hellerhoff', 'CC BY-SA 3.0', 'Spontanpneumothorax rechts 2012.jpg') },
        'cxr-ptx-simple': { modality: 'X-ray', ...C('Hellerhoff', 'CC BY-SA 4.0', 'Pneumothorax rechts nach Sturz 30W - CR pa - 001.jpg') },
        'cxr-ptx-spontaneous': { modality: 'X-ray', ...C('Hellerhoff', 'CC BY-SA 4.0', 'Maessiger Spannungspneumothorax links 21M - CR pa - 001.jpg') },
        'cxr-pneumonia': { modality: 'X-ray', ...C('Mikael Häggström', 'CC0', 'X-ray of lobar pneumonia.jpg') },
        'cxr-pneumonia-2': { modality: 'X-ray', ...C('Hellerhoff', 'CC BY-SA 3.0', 'Mittellappenpneumonie.jpg') },
        'cxr-oedema': { modality: 'X-ray', ...C('Hellerhoff', 'CC BY-SA 4.0', 'Schmetterlingsoedem bei kardialer Dekompensation 64W - CR ap - 001.jpg') },
        'cxr-oedema-shock': { modality: 'X-ray', ...C('Hellerhoff', 'CC BY-SA 4.0', 'Lungenoedem bei kardiogenem Schock 73M - CR ap - 001.jpg') },
        'cxr-drowning': { modality: 'X-ray', ...C('Dr Terence McManus', 'CC BY-SA 4.0', 'Salt water aspiration syndrome chest x-ray, before treatment.png') },
        'cxr-ards': { modality: 'X-ray', ...C('James Heilman, MD', 'CC BY-SA 4.0', 'ARDSSevere.png') },
        'cxr-effusion': { modality: 'X-ray', ...C('Clinical Cases (clinicalcases.org)', 'CC BY-SA 2.5', 'Left-sided Pleural Effusion.jpg') },
        'cxr-haemothorax': { modality: 'X-ray', ...C('Hamid Reza Mahoozi, Jan Volmerig and Erich Hecker', 'CC BY 4.0', 'Chest-X-ray-Left-sided-hemothorax.png') },
        'cxr-free-air': { modality: 'X-ray', ...C('Hellerhoff', 'CC BY-SA 4.0', 'Freie Luft bei Sigmaperforation 71W - CR ap - 001.jpg') },
        'cxr-pneumomediastinum': { modality: 'X-ray', ...C('Hellerhoff', 'CC BY-SA 4.0', 'Mediastinalemphysem Perforation Oesophaguskarzinom.jpg') },
        'cxr-copd': { modality: 'X-ray', ...C('James Heilman, MD', 'CC BY-SA 3.0', 'COPD.JPG') },
        'cxr-pericardial-effusion': { modality: 'X-ray', ...C('James Heilman, MD', 'CC BY-SA 3.0', 'PericardialeffusionCXR.PNG') },
        'cxr-bronchiolitis': { modality: 'X-ray', ...C('Matteo Di Nardo, Daniela Perrotta, Francesca Stoppa, Corrado Cecchetti, Marco Marano and Nicola Pirozzi', 'CC BY 2.0', 'Bronchiolitis chest X-ray.jpg') },
        'xr-nof': { modality: 'X-ray', ...C('Hellerhoff', 'CC BY-SA 4.0', 'Laterale Schenkelhalsfraktur links 44W - CR ap - 001.jpg') },
        'xr-supracondylar': { modality: 'X-ray', ...C('James Heilman, MD', 'CC BY-SA 4.0', 'Supracondylarfrac.png') },
        'ct-normal-head': { modality: 'CT', ...C('Mikael Häggström', 'CC0', 'CT of a normal brain, axial 18.png', 'Cropped to the axial slice (scout image removed); resized') },
        'ct-sah': { modality: 'CT', ...C('Hellerhoff', 'CC BY-SA 4.0', 'Basale Subarachnoidalblutung bei Anterioraneurysma 43M - CT axial - 001.jpg', 'Cropped to one axial slice; resized') },
        'ct-dense-mca': { modality: 'CT', ...C('Hellerhoff', 'CC BY-SA 3.0', 'Dens media sign mit Mediainfarkt - CCT 001.jpg', 'Cropped to the first (early) scan; resized') },
        'ct-ich': { modality: 'CT', ...C('James Heilman, MD', 'CC BY-SA 4.0', 'Intra Parenchymal Bleed with Edema.jpg') },
        'ct-subdural': { modality: 'CT', ...C('Glitzy queen00 (English Wikipedia)', 'Public domain', 'Trauma subdural.jpg') },
        'ct-edh': { modality: 'CT', ...C('Hellerhoff', 'CC BY-SA 4.0', 'Grosses epidurales Haematom nach Sturz 87W - CT - 001.jpg', 'Cropped to the axial slice; resized') },
        'ct-hydrocephalus': { modality: 'CT', ...C('Lucien Monfils', 'CC BY-SA 3.0', 'Hydrocephalus.jpg') },
        'ct-pe': { modality: 'CT', ...C('Hellerhoff', 'CC BY-SA 3.0', 'Reitender Thrombus bei Lungenembolie - CT - axial - 008.jpg') },
        'ct-pancreatitis': { modality: 'CT', ...C('Hellerhoff', 'CC BY-SA 3.0', 'Akute exsudative Pankreatitis - CT axial.jpg') },
        'ct-spleen': { modality: 'CT', ...C('Hellerhoff', 'CC BY-SA 4.0', 'Traumatische Milzruptur mit subkapsulaerem Haematom 81M - CT KM pv - 001.jpg', 'Cropped to the axial image; resized') },
        'ecg-stemi-anterior': { modality: 'ECG', rhythms: SINUS, ...C('Displaced (Wikimedia Commons)', 'Public domain', '12 Lead EKG ST Elevation tracing only.jpg') },
        'ecg-stemi-anterior-2': { modality: 'ECG', rhythms: SINUS, ...C('Various (journal case report)', 'CC BY 4.0', 'ST elevation myocardial infarction ECG (cropped).jpg') },
        'ecg-stemi-inferior': { modality: 'ECG', rhythms: SINUS, ...C('Glenlarson', 'Public domain', '12 lead generated inferior MI.JPG', 'Cropped to remove the machine interpretation; resized') },
        'ecg-hyperkalaemia': { modality: 'ECG', rhythms: SINUS, ...C('CardioNetworks ECGpedia', 'CC BY-SA 3.0', '118 (CardioNetworks ECGpedia).jpg') },
        'ecg-pe': { modality: 'ECG', rhythms: SINUS, ...C('Jmh649 / James Heilman, MD (Wikimedia Commons)', 'CC BY 3.0', 'Pulm embolism.jpg') },
        'ecg-chb': { modality: 'ECG', rhythms: ['Complete Heart Block'], ...C('Michael Rosengarten, McGill University / CardioNetworks ECGpedia', 'CC BY-SA 3.0', 'E312 (CardioNetworks ECGpedia).jpg') },
        'ecg-brugada': { modality: 'ECG', rhythms: SINUS, ...C('P.G. Postema, AMC / CardioNetworks ECGpedia', 'CC BY-SA 3.0', 'Brugada syndrome type1 example4 (CardioNetworks ECGpedia).png') },
        'ecg-alternans': { modality: 'ECG', rhythms: SINUS, ...C('James Heilman, MD', 'CC BY-SA 3.0', 'Electrical Alternans.JPG') },
        'ecg-wellens': { modality: 'ECG', rhythms: SINUS, ...C('James Heilman, MD', 'CC BY-SA 3.0', 'WellensPainfree.JPG') },
        'ecg-lvh': { modality: 'ECG', rhythms: SINUS, ...C('CardioNetworks ECGpedia', 'CC BY-SA 3.0', 'Extreme lvh2 (CardioNetworks ECGpedia).jpg') },
        'ecg-long-qt': { modality: 'ECG', rhythms: SINUS, ...C('CardioNetworks ECGpedia', 'CC BY-SA 3.0', 'Lqts1 (CardioNetworks ECGpedia).png') },
        'us-b-lines': { modality: 'POCUS', ...C('Tinss', 'CC BY-SA 4.0', 'B lines on a lung ultrasound of a patient with fibrosis.jpg') },
        'us-pyloric': { modality: 'POCUS', ...C('Dr Laughlin Dawes', 'CC BY-SA 4.0', 'PyloricStenosisUS.jpg') }
    };
    Object.keys(IMAGES).forEach(k => { IMAGES[k].src = `images/investigations/${k}.jpg`; });

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
            F('cxr-rll', 'Right lower lobe consolidation', 'Chest X-ray: consolidation at the right base (right lower lobe), with an air bronchogram. Right hemidiaphragm partly obscured. In keeping with aspiration pneumonia.'),
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
            F('cxr-pjp', 'PJP pneumonia', 'Chest X-ray: bilateral, symmetrical perihilar ground-glass and fine reticular shadowing. No effusion. In an HIV-positive patient this suggests Pneumocystis (PJP) pneumonia.'),
            F('cxr-wide-mediastinum', 'Widened mediastinum (trauma)', 'Chest X-ray (supine): widened mediastinum with loss of the aortic knuckle and depression of the left main bronchus. Suspect traumatic aortic injury: CT aortogram.'),
            F('cxr-diaphragm', 'Diaphragmatic rupture', 'Chest X-ray: the nasogastric tube coils in the left chest and bowel loops are seen above the expected line of the left hemidiaphragm. Left diaphragmatic rupture.'),
            F('cxr-rib-fractures', 'Multiple rib fractures (no pneumothorax)', 'Chest X-ray: multiple rib fractures, including a segmental (flail) section. No pneumothorax or haemothorax on this film.'),
            F('cxr-blast-lung', 'Blast lung', "Chest X-ray: bilateral perihilar ('butterfly') airspace shadowing in keeping with blast lung. No pneumothorax."),
            F('cxr-svco', 'Superior mediastinal mass (SVCO)', 'Chest X-ray: widened superior mediastinum with a right paratracheal mass. In keeping with a mediastinal tumour causing SVC obstruction.'),
            F('xr-neck-croup', 'Croup: steeple sign (neck X-ray)', 'AP neck X-ray: subglottic narrowing of the trachea (steeple sign). Croup is a clinical diagnosis; imaging is not needed.'),
            F('xr-neck-epiglottitis', 'Epiglottitis: thumb sign (lateral neck)', "Lateral neck X-ray: swollen epiglottis (thumb sign) with thickened aryepiglottic folds. Do not delay airway management for imaging."),
            F('xr-button-battery', 'Button battery in oesophagus', 'Chest / neck X-ray: round radio-opaque foreign body in the upper oesophagus with a double-ring (halo) edge, the appearance of a button battery. Emergency removal.'),
            F('xr-fb-aspiration', 'Inhaled foreign body (air trapping)', 'Chest X-ray (inspiratory and expiratory): the right lung stays hyperinflated on expiration (air trapping) with the mediastinum shifting to the left. Suspect an inhaled foreign body in the right main bronchus.'),
            F('xr-nof', 'Fractured neck of femur (left)', 'Pelvis X-ray (AP): complete, partly displaced fracture of the left femoral neck, towards its lateral end (Garden III). The round marker is a calibration ball for implant planning.', 'xr-nof'),
            F('xr-supracondylar', 'Supracondylar fracture (child)', 'Elbow X-ray (lateral): displaced supracondylar fracture of the distal humerus.', 'xr-supracondylar'),
            F('axr-lbo', 'Large bowel obstruction (AXR)', 'Abdominal X-ray: markedly dilated large bowel down to the sigmoid, with no gas in the rectum. Small bowel not dilated (competent ileocaecal valve). Large bowel obstruction.'),
            F('axr-sbo', 'Small bowel obstruction (AXR)', 'Abdominal X-ray: multiple dilated loops of small bowel in the central abdomen with little gas in the colon. Small bowel obstruction.')
        ],
        'CT': [
            F('ct-normal-head', 'Normal CT head', 'CT head (non-contrast): no acute intracranial abnormality. No haemorrhage, mass effect or established infarct.', 'ct-normal-head'),
            F('ct-sah', 'Subarachnoid haemorrhage', 'CT head (non-contrast): hyperdense blood in the basal cisterns. Acute subarachnoid haemorrhage.', 'ct-sah'),
            F('ct-dense-mca', 'Acute stroke: dense left MCA', 'CT head (non-contrast): hyperdense left middle cerebral artery (dense MCA sign), from acute thrombus. No haemorrhage.', 'ct-dense-mca'),
            F('ct-ich', 'Intracerebral haemorrhage (right)', 'CT head (non-contrast): large right-sided intraparenchymal haemorrhage with surrounding oedema and mass effect.', 'ct-ich'),
            F('ct-subdural', 'Acute subdural haematoma (left)', 'CT head (non-contrast): acute left subdural haematoma with midline shift.', 'ct-subdural'),
            F('ct-edh', 'Extradural haematoma (right)', 'CT head (non-contrast): large right frontal extradural haematoma (biconvex hyperdense collection) with mass effect and early subfalcine herniation.', 'ct-edh'),
            F('ct-hydrocephalus', 'Hydrocephalus', 'CT head (non-contrast): dilated lateral ventricles. Hydrocephalus.', 'ct-hydrocephalus'),
            F('ct-pe', 'Pulmonary embolism (CTPA)', 'CT pulmonary angiogram: large central filling defects straddling the main pulmonary arteries (saddle embolus). The left main pulmonary artery is almost completely occluded.', 'ct-pe'),
            F('ct-pancreatitis', 'Acute pancreatitis', 'CT abdomen (contrast): swollen pancreas with extensive peripancreatic fluid and fat stranding. Acute pancreatitis.', 'ct-pancreatitis'),
            F('ct-spleen', 'Splenic rupture', 'CT abdomen (contrast, portal venous phase): splenic injury with a subcapsular haematoma. Small bilateral pleural effusions.', 'ct-spleen'),
            F('ct-cerebellar', 'Cerebellar infarct', 'CT head (non-contrast): low density in the right cerebellar hemisphere with mild mass effect on the fourth ventricle. Posterior circulation infarct; CT angiography and MRI recommended.'),
            F('ct-aaa', 'Ruptured AAA', 'CT aorta: 8 cm infrarenal abdominal aortic aneurysm with a large left retroperitoneal haematoma. Ruptured AAA.'),
            F('ct-dissection', 'Aortic dissection (type A)', 'CT aorta: intimal flap from the ascending aorta to the iliac bifurcation. Stanford type A dissection.'),
            F('ct-aortic-injury', 'Traumatic aortic injury', 'CT aortogram: contained rupture of the aortic isthmus with a pseudoaneurysm and mediastinal haematoma.'),
            F('ct-perforation', 'Perforated viscus', 'CT abdomen: free intraperitoneal gas and fluid around the duodenum. Perforated duodenal ulcer.'),
            F('ct-mesenteric', 'Mesenteric ischaemia', 'CT mesenteric angiogram: occlusion of the superior mesenteric artery with thin-walled, poorly enhancing small bowel and pneumatosis. Acute mesenteric ischaemia.'),
            F('ct-kub-stone', 'Obstructing ureteric stone', 'CT KUB: 7 mm calculus at the right vesicoureteric junction with right hydroureter and hydronephrosis, and perinephric stranding.'),
            F('ct-lbo', 'Large bowel obstruction (CT)', 'CT abdomen: obstructing sigmoid tumour with a dilated colon proximally (caecum 11 cm). No free gas.'),
            F('ct-pituitary', 'Pituitary apoplexy', 'CT head: hyperdense, enlarged pituitary mass extending above the sella. Pituitary apoplexy; MRI recommended.'),
            F('ct-hsv', 'HSV encephalitis', 'CT head: subtle low density in the left medial temporal lobe. MRI: high signal in the left temporal lobe and insula, typical of HSV encephalitis.'),
            F('ct-vad', 'Vertebral artery dissection', 'CT angiogram: tapering narrowing of the left vertebral artery (dissection), with a small left cerebellar infarct.'),
            F('ct-cord', 'Spinal cord compression (MRI)', 'MRI whole spine: metastatic collapse of T8 with epidural tumour compressing the spinal cord.'),
            F('ct-orbit', 'Retrobulbar haematoma', 'CT orbits: retrobulbar haematoma with proptosis and stretching of the optic nerve (tenting of the globe).'),
            F('ct-face', 'Maxillofacial fractures', 'CT face: bilateral Le Fort II fractures with comminuted nasal bones and blood in the maxillary sinuses.'),
            F('ct-neck-abscess', 'Deep neck infection', 'CT neck (contrast): floor-of-mouth cellulitis with a submandibular collection and narrowing of the airway.'),
            F('ct-nec-fasc', 'Necrotising fasciitis', 'CT: gas tracking along fascial planes with fascial thickening and fluid.'),
            F('ct-nai', 'Subdural haematomas (consider NAI)', 'CT head: thin subdural collections of differing densities over both hemispheres. Consider non-accidental injury: skeletal survey and safeguarding referral.'),
            F('ct-paeds-edh', 'Extradural haematoma (child)', 'CT head: biconvex extradural haematoma under a temporal skull fracture, with mass effect.')
        ],
        'ECG': [
            F('ecg-stemi-anterior', 'Anterior STEMI', '12-lead ECG: sinus tachycardia. ST elevation V2–V5: acute anterior STEMI. Left anterior fascicular block.', 'ecg-stemi-anterior'),
            F('ecg-stemi-anterior-2', 'Anterior STEMI (2)', '12-lead ECG: sinus rhythm. ST elevation in V2–V5, I and aVL: acute anterior STEMI.', 'ecg-stemi-anterior-2'),
            F('ecg-stemi-inferior', 'Inferior STEMI', '12-lead ECG: sinus rhythm about 100/min. ST elevation in II, III and aVF with reciprocal ST depression: acute inferior STEMI.', 'ecg-stemi-inferior'),
            F('ecg-hyperkalaemia', 'Severe hyperkalaemia', '12-lead ECG: broad, bizarre QRS complexes with no clear P waves and peaked T waves. Severe hyperkalaemia (pre-arrest pattern).', 'ecg-hyperkalaemia'),
            F('ecg-pe', 'PE: S1Q3T3', '12-lead ECG: sinus tachycardia about 100/min. Deep S wave in I, Q wave and inverted T wave in III (S1Q3T3).', 'ecg-pe'),
            F('ecg-chb', 'Complete heart block', '12-lead ECG: complete (third-degree) heart block. P waves march through independently of a slow, regular escape rhythm.', 'ecg-chb'),
            F('ecg-brugada', 'Brugada type 1', '12-lead ECG: coved ST elevation with T-wave inversion in V1–V2. Brugada type 1 pattern.', 'ecg-brugada'),
            F('ecg-alternans', 'Low voltage with electrical alternans', '12-lead ECG: sinus tachycardia with low-voltage QRS complexes and electrical alternans (QRS amplitude changing beat to beat).', 'ecg-alternans'),
            F('ecg-wellens', 'Wellens pattern', '12-lead ECG (pain-free): sinus rhythm. Deep, symmetrical T-wave inversion V3–V6 with a biphasic T wave in V2. R waves preserved, no Q waves. Wellens pattern (critical proximal LAD stenosis).', 'ecg-wellens'),
            F('ecg-lvh', 'LVH with strain', '12-lead ECG: sinus rhythm. Very large QRS voltages with lateral ST depression and T-wave inversion. Left ventricular hypertrophy with strain.', 'ecg-lvh'),
            F('ecg-long-qt', 'Long QT', '12-lead ECG: sinus rhythm about 60/min. Markedly prolonged QT interval with broad T waves.', 'ecg-long-qt')
        ],
        'POCUS': [
            F('us-b-lines', 'Lung: B-lines', "Lung ultrasound: multiple B-lines (vertical 'comet-tail' artefacts) in both lungs. Interstitial fluid, e.g. pulmonary oedema.", 'us-b-lines'),
            F('us-pyloric', 'Pyloric stenosis', 'Ultrasound abdomen (infant): thickened, elongated pylorus. Pyloric stenosis.', 'us-pyloric'),
            F('us-ptx', 'Lung: no sliding (pneumothorax)', 'Lung ultrasound: no lung sliding and no B-lines on the affected side; barcode (stratosphere) sign on M-mode. Pneumothorax.'),
            F('us-tamponade', 'Pericardial effusion with tamponade', 'Echo: large circumferential pericardial effusion with diastolic collapse of the right ventricle and a plethoric IVC. Tamponade.'),
            F('us-fast-positive', 'FAST: free fluid', "FAST: free fluid in Morison's pouch (hepatorenal space) and around the spleen. In this trauma patient, presumed haemoperitoneum."),
            F('us-rv-dilated', 'Echo: dilated right ventricle', 'Echo: dilated right ventricle (larger than the left) with septal flattening (D-sign). Right heart strain, in keeping with massive PE.'),
            F('us-aaa', 'Aorta: AAA', 'Ultrasound aorta: infrarenal abdominal aortic aneurysm, 7.5 cm. Retroperitoneal rupture cannot be excluded on ultrasound.'),
            F('us-ectopic', 'Ectopic pregnancy', "Pelvic ultrasound: empty uterus with free fluid in the pouch of Douglas and Morison's pouch. With a positive pregnancy test, ruptured ectopic pregnancy."),
            F('us-intussusception', 'Intussusception (target sign)', 'Ultrasound abdomen: target (doughnut) sign in the right upper quadrant. Ileocolic intussusception.'),
            F('us-hydronephrosis', 'Hydronephrosis', 'Ultrasound: right hydronephrosis with a dilated renal pelvis and calyces.'),
            F('us-poor-lv', 'Echo: poor LV function', 'Echo: dilated, globally poorly contracting left ventricle (estimated ejection fraction under 25%). No pericardial effusion.'),
            F('us-bladder', 'Large bladder (retention)', 'Bladder ultrasound: distended bladder, estimated volume 1.4 litres. Bilateral mild hydronephrosis.'),
            F('us-cbd', 'Dilated bile duct', 'Ultrasound: gallstones with a dilated common bile duct (11 mm) and intrahepatic duct dilatation.'),
            F('us-torsion', 'Testicular torsion', 'Testicular ultrasound: enlarged left testis with absent colour Doppler flow and a twisted spermatic cord (whirlpool sign). Do not delay surgery for imaging.'),
            F('us-ovarian-torsion', 'Ovarian torsion', 'Pelvic ultrasound: enlarged right ovary with peripheral follicles and reduced Doppler flow. Suspected ovarian torsion.')
        ]
    };
    const byId = {};
    Object.keys(FINDINGS).forEach(type => FINDINGS[type].forEach(f => { byId[f.id] = { ...f, type }; }));

    // ---- Each scenario's own results (scenario id -> finding id per investigation) ----------------
    // Only where the scenario has an abnormal (or specifically illustrated) result; everything else
    // keeps its existing result. ECG entries add a real 12-lead image to the scenario's own ECG text.
    const SCENARIO_RESULTS = {
        AM001: { ECG: 'ecg-stemi-anterior' },
        AM002: { 'X-ray': 'cxr-pneumonia' },
        AM003: { 'X-ray': 'cxr-asthma' },
        AM004: { ECG: 'ecg-hyperkalaemia' },
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
        AM066: { 'X-ray': 'cxr-oedema-shock', ECG: 'ecg-stemi-anterior-2', POCUS: 'us-poor-lv' },
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
        AT002: { 'X-ray': 'cxr-ptx-simple', POCUS: 'us-ptx' },
        AT003: { CT: 'ct-edh' },
        AT006: { 'X-ray': 'cxr-rib-fractures' },
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
        AT031: { ECG: 'ecg-long-qt' },
        EL001: { 'X-ray': 'xr-nof' },
        EL003: { CT: 'ct-subdural' },
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
        const out = { ...investigations };
        Object.keys(map).forEach(type => {
            const r = asResult(map[type]);
            if (!r) return;
            const key = KEY[type];
            if (type === 'ECG') {
                // Keep the scenario's own ECG type and wording; add the real 12-lead image.
                out.ecg = { ...(out.ecg || {}), image: r.image, imageReport: r.findings, findingId: r.findingId };
            } else {
                out[key] = r;
            }
        });
        return out;
    };

    // The image that should go with a result, if any: an explicit key, or the scenario's own.
    const imageFor = (key) => (key && IMAGES[key]) ? IMAGES[key] : null;
    // A real ECG image is only used while the patient's rhythm is one it can stand for.
    const ecgImageFits = (key, rhythm) => {
        const img = imageFor(key);
        if (!img || img.modality !== 'ECG') return false;
        const R = window.RHYTHMS;
        const r = R ? R.canonical(rhythm || 'Sinus Rhythm') : rhythm;
        return !img.rhythms || img.rhythms.indexOf(r) !== -1;
    };
    const creditText = (img) => img ? `${img.author}, ${img.licence}, via Wikimedia Commons${img.modified && img.modified !== 'Resized' ? ` (${img.modified.toLowerCase()})` : ''}` : '';

    window.INVESTIGATIONS = { IMAGES, FINDINGS, SCENARIO_RESULTS, byId, asResult, applyScenarioResults, imageFor, ecgImageFits, creditText, KEY };
})();
