# LinkedIn Carousel Factory

Turns a Google Sheet post into an unpublished Buffer draft: two scheduled-task prompts (`prompts/`) write the brief and slide JSON, and a GitHub Actions worker renders the eight-slide carousel (HTML, PDF, cover JPEG, eight PNGs), stores it in Cloudinary, and creates the draft. See `README.md` for the pipeline and commands.

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context, scoped to this subdirectory. Glossary is `GLOSSARY.md`, ADRs go in `docs/adr/`. See `docs/agents/domain.md`.
