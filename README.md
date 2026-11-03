# CEED Mock Test

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
| `questions/` | Question screenshots (CEED 2017 Part A, 45 questions) |
| `supabase/schema.sql` | Database tables and functions (already installed in Supabase) |
| `.github/workflows/keep-alive.yml` | Pings the database once a day so it never goes to sleep |

## How it works

- The website is plain HTML, hosted free on GitHub Pages.
- Answers, timing and results are saved in a free Supabase database (project `ceed-mock-test`, Mumbai region). Nothing is deleted after the exam.
- Students only enter their name and email (no password or OTP). The same email on another device continues an unfinished test.
- The answer key never reaches the browser during the test. It stays inside the database and is shown only after a student submits.
- The key in `assets/config.js` is a public key. It can only run the exam functions; it cannot read or change the tables.

## Admin

Open `admin.html` (there is an **Admin** link at the bottom of the home page) and enter the admin passcode.

- **Results & ranks** – rank list for each paper (by first or best attempt), every attempt, and a CSV download for Excel.
- **Students** – everyone who has taken a test, with their best score.
- **Papers & questions** – add a paper, paste question screenshots one by one, set the answer key, publish or unpublish. If you correct an answer, click **Re-evaluate** to re-mark every student.
- **Change passcode** – on the Overview page.

## If the site says it cannot reach the test server

Supabase pauses free projects after 7 days without visitors. The keep-alive workflow prevents this. If it ever happens, open https://supabase.com/dashboard, choose the project `ceed-mock-test` and click **Restore**. No data is lost.

## Rebuilding the database (only needed for a brand-new Supabase project)

1. In the Supabase SQL editor, run `supabase/schema.sql`.
2. Set an admin passcode (replace both texts):
   `insert into app.config (key, value) values ('admin_salt', 'any-random-text'), ('admin_hash', encode(sha256(convert_to('any-random-text' || 'YOUR-PASSCODE', 'UTF8')), 'hex'));`
3. Put the new project URL and publishable key in `assets/config.js` and in the keep-alive workflow.
4. Add the papers and answer keys from the admin page.

Questions © IIT Bombay (CEED). This is an independent practice website, not affiliated with IIT Bombay.
