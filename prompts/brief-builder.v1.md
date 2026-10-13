You are processing a Google Sheet → Google Drive carousel job queue.
SOURCE SHEET:
- Google Sheet: "Test sheet"
- Worksheet: "Sheet1"
DRIVE:
- Folder: "Carousell Jobs"
OBJECTIVE:
Process at most ONE queued job per run, analyze its post, create or reuse its brief JSON file, and update only that job's row.
FOLLOW THESE STEPS IN ORDER:
1. Find the first row in "Test sheet" → "Sheet1" whose status cell is EXACTLY:
queued
2. If no row has status exactly "queued":
- Make no changes anywhere.
- Report: "No queued jobs found."
- Stop immediately.
3. If a queued row exists:
- Read its job_id and post_text.
- Immediately change ONLY that row's status to:
processing
- Do this BEFORE doing any other processing.
4. Directly list the contents of the Google Drive folder:
"Carousell Jobs"
5. For this job, the required filename is:
{job_id}-brief-v1.json
Replace {job_id} with the actual job_id from the Sheet.
6. Check the folder listing for an EXACT filename match.
7. If that exact JSON file already exists:
- DO NOT create another file.
- Use the existing file.
- Record its Google Drive file URL.
- Skip to step 9.
8. If the exact JSON file does NOT exist, analyze the complete source post and create a new JSON file in "Carousell Jobs" with exactly this structure:
{
"jobId": "<job_id>",
"sourcePost": "<complete unmodified post_text>",
"primaryType": "",
"secondaryType": "",
"thesis": "",
"audience": "",
"tone": [],
"readerShift": {
"from": "",
"to": ""
},
"narrativeBeats": [],
"visualNeeds": [],
"referenceCollection": "",
"slideCount": 8
}
Requirements:
- primaryType must be exactly one of: contrarian, how-to, framework, story, comparison, or case-study.
- secondaryType may be one of those values or educational.
- thesis must express the post's central argument in one sentence.
- audience must describe the intended reader without inventing unsupported details.
- tone must contain 2–4 concise descriptors.
- readerShift.from must describe what the reader likely believes before the carousel.
- readerShift.to must describe what the carousel wants them to believe afterward.
- narrativeBeats must contain 5–8 ordered, non-empty beats.
- visualNeeds must contain the slide treatments needed to communicate the argument.
- referenceCollection must be "dark-editorial". Never invent a collection name.
- Do not write empty strings or empty arrays.
- Do not generate slide copy yet.
- Preserve sourcePost exactly, character for character.
- Validate every requirement before saving. If validation fails, do not create the file.
9. After the JSON file has been successfully created OR an existing exact file has been successfully found:
Update ONLY the original Sheet row:
- status = brief_created
- brief_file = the Google Drive URL of the JSON file
10. If ANY processing step fails:
- Update ONLY the original row's status to:
failed
- Do NOT delete or alter the source post.
- Do NOT modify any other row.
- Report exactly what failed.
IMPORTANT RULES:
- Process AT MOST ONE queued row per run.
- Never process a row whose status is processing, brief_created, or failed.
- Never modify any other Sheet row.
- Never overwrite an existing JSON file.
- Never create a duplicate JSON file when the exact required filename already exists.
- The filename comparison must be exact.
- Use the actual Drive file URL in the brief_file cell.
- Do not create files outside the "Carousell Jobs" folder.
- Do not change the post_text.
- Do not change the job_id.
- If no queued job exists, make absolutely no changes.
FINAL REPORT:
After the run, report:
1. Job ID processed
2. Original status
3. Final status
4. Whether a new JSON file was created or an existing file was reused
5. JSON filename
6. Google Drive URL
7. primaryType and thesis chosen
8. Any errors encountered
If no queued job exists, simply report:
"No queued jobs found. No changes made."
