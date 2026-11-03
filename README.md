# CEED Mock Test

**Created by [Sumit Baranwal](https://www.linkedin.com/in/baranwalsumit/)** · [Join the CEED / NID Prep group on WhatsApp](https://chat.whatsapp.com/KRwNf9wtZzXHsLG4bHB9PU) · [Topmate: sumit_baranwal](https://topmate.io/sumit_baranwal/)

Free online mock tests of CEED previous-year papers (Part A) in the real computer-based exam interface, with a detailed analysis after every attempt.

**Live site:** https://baranwalsumit70-gif.github.io/CEED_Previous_Year_Mock/

## What is in this repository

| File / folder | What it is |
| --- | --- |
| `index.html` | Home page: available papers, "My results", exam pattern, FAQ |
| `exam.html` | Candidate login (name + email) → instructions → the exam |
| `result.html` | The analysis a student sees after submitting |
| `admin.html` | Admin page (passcode): results & ranks, students, papers & questions |
| `assets/` | Styles and scripts. `assets/config.js` connects the site to the database |
| `assets/credit.js` | The "Created by Sumit Baranwal" strip at the top of every page (LinkedIn, WhatsApp group and Topmate links). Change the links here |
| `questions/` | Question screenshots, one folder per paper: CEED 2017 and CEED 2022–2026 (Part A, 259 questions) |
| `supabase/schema.sql` | Database tables and functions (already installed in Supabase) |
| `.github/workflows/keep-alive.yml` | Pings the database once a day so it never goes to sleep |

## How it works

- The website is plain HTML, hosted free on GitHub Pages.
- Answers, timing and results are saved in a free Supabase database (project `ceed-mock-test`, Mumbai region). Nothing is deleted after the exam.
- Students only enter their name and email (no password or OTP). The same email on another device continues an unfinished test.
- The answer key never reaches the browser during the test. It stays inside the database and is shown only after a student submits.
- Each paper is marked with its own year's official scheme and key: CEED 2024–2026 use MSQ partial marking, official "OR" answers (like "7 OR 9") are accepted, and officially dropped questions give marks to everyone.
- A few questions showed an animated GIF in the real exam. When a question can't be answered from the still image, it gives marks to everyone (the admin can change this per question).
- The key in `assets/config.js` is a public key. It can only run the exam functions; it cannot read or change the tables.

## Admin

Open `admin.html` (there is an **Admin** link at the bottom of the home page) and enter the admin passcode.

- **Results & ranks** – rank list for each paper (by first or best attempt), every attempt, and a CSV download for Excel.
- **Students** – everyone who has taken a test, with their best score.
- **Papers & questions** – add a paper, paste question screenshots one by one, set the answer key, publish or unpublish. If you correct an answer, click **Re-evaluate** to re-mark every student.
- **Change passcode** – on the Overview page.

## Uploading to GitHub

GitHub's "Upload files" page takes at most 100 files at a time, so the website comes in four zips. Unzip each one and drag everything inside it onto **Add file → Upload files** in the main page of the repository, then click **Commit changes**:

1. `upload-1-website.zip` – the website and the CEED 2017 questions
2. `upload-2-questions-2022-2023.zip`
3. `upload-3-questions-2024-2025.zip`
4. `upload-4-questions-2026.zip`

Each zip keeps the `questions/` folder, so the files land in the right place.

## If the site says it cannot reach the test server

Supabase pauses free projects after 7 days without visitors. The keep-alive workflow prevents this. If it ever happens, open https://supabase.com/dashboard, choose the project `ceed-mock-test` and click **Restore**. No data is lost.

## Rebuilding the database (only needed for a brand-new Supabase project)

1. In the Supabase SQL editor, run `supabase/schema.sql`.
2. Set an admin passcode (replace both texts):
   `insert into app.config (key, value) values ('admin_salt', 'any-random-text'), ('admin_hash', encode(sha256(convert_to('any-random-text' || 'YOUR-PASSCODE', 'UTF8')), 'hex'));`
3. Put the new project URL and publishable key in `assets/config.js` and in the keep-alive workflow.
4. Load the papers: run your private `papers-answer-keys-backup.sql` (not in this public repository, because it holds the answer keys) in the SQL editor, or add papers from the admin page.

Questions © IIT Bombay (CEED). This is an independent practice website, not affiliated with IIT Bombay.
