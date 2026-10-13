You are processing a Google Sheet → Google Drive carousel job queue.
SOURCE SHEET:
- Google Sheet: "Test sheet"
- Worksheet: "Sheet1"
DRIVE:
- Folder: "Carousell Jobs"
OBJECTIVE:
Process at most ONE briefed job per run, write its eight-slide carousel JSON, and update only that job's row.
FOLLOW THESE STEPS IN ORDER:
1. Find the first row in "Test sheet" → "Sheet1" whose status cell is EXACTLY:
brief_created
2. If no row has status exactly "brief_created":
- Make no changes anywhere.
- Report: "No briefed jobs found."
- Stop immediately.
3. If such a row exists:
- Read its job_id and its brief JSON file (open the URL in brief_file).
- Immediately change ONLY that row's status to:
carousel_processing
- Do this BEFORE doing any other processing.
4. Directly list the contents of the Google Drive folder:
"Carousell Jobs"
5. For this job, the required filename is:
{job_id}-carousel-v1.json
Replace {job_id} with the actual job_id from the Sheet.
6. Check the folder listing for an EXACT filename match.
7. If that exact JSON file already exists:
- DO NOT create another file.
- Use the existing file.
- Record its Google Drive file URL.
- Skip to step 9.
8. If the exact JSON file does NOT exist, read the editorial brief and write the eight-slide carousel JSON. Create the file in "Carousell Jobs" with exactly this structure:
{
"jobId": "<job_id>",
"title": "",
"caption": "",
"style": {
"family": "dark-editorial",
"accent": "electric-blue",
"density": "low"
},
"slides": []
}
Requirements:
- jobId must equal the Sheet job_id exactly.
- title is the carousel's display title, one line.
- caption is one or two sentences for the LinkedIn post text. Sharp, no hashtag spam.
- style must be exactly dark-editorial / electric-blue / low. No other values.
- slides must contain exactly 8 objects. No more, no fewer.
- Each slide has a layout field, exactly one of: editorial-hook, framework-overview, statement, comparison, closing.
- Layout fields:
- editorial-hook: required headline; optional accentText.
- framework-overview: required title; required items array of 1–4 non-empty strings; optional footer.
- statement: required headline; optional body.
- comparison: required leftTitle, leftBody, rightTitle, rightBody; optional footer.
- closing: required headline and body.
- Every required field must be a non-empty string. No empty strings anywhere.
- Follow the brief's narrativeBeats in slide order. Headlines under 12 words, bodies under 25 words.
- Validate every requirement before saving. Count the slides. If validation fails, do not create the file.
9. After the JSON file has been successfully created OR an existing exact file has been successfully found:
Update ONLY the original Sheet row:
- status = carousel_created
- carousel_file = the Google Drive URL of the JSON file
10. If ANY processing step fails:
- Update ONLY the original row's status to:
failed
- Do NOT delete or alter the source post.
- Do NOT modify any other row.
- Report exactly what failed.
IMPORTANT RULES:
- Process AT MOST ONE brief_created row per run.
- Never process a row whose status is carousel_processing, carousel_created, or failed.
- Never modify any other Sheet row.
- Never overwrite an existing JSON file.
- Never create a duplicate JSON file when the exact required filename already exists.
- The filename comparison must be exact.
- Use the actual Drive file URL in the carousel_file cell.
- Do not create files outside the "Carousell Jobs" folder.
- Do not change the post_text.
- Do not change the job_id.
- If no briefed job exists, make absolutely no changes.
FINAL REPORT:
After the run, report:
1. Job ID processed
2. Original status
3. Final status
4. Whether a new JSON file was created or an existing file was reused
5. JSON filename
6. Google Drive URL
7. Slide count and layout sequence used
8. Any errors encountered
If no briefed job exists, simply report:
"No briefed jobs found. No changes made."
Once a row reaches carousel_created, the GitHub worker owns it — ChatGPT never touches that row again.
