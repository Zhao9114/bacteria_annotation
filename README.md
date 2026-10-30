# Cell Annotator

A web app for marking bacteria cells in microscope photos and measuring the distance from each cell's dark center to its outer ring. The measurements use the same method as the lab's neural-network pipeline (`measure_bacteria.py`, `inner2outer`), so hand annotations can be compared with the network's results.

---

## For annotators (doctors and students)

### Getting started

1. Open the app link you were given.
2. **Online version:** type your email and click **Email me a sign-in link**. Open the email on the same computer and click the link. No password is needed.
3. The first time, enter your name. It is saved with every cell you mark.

### Adding images

On the **Images** page, click **Upload images** or drag photos onto the page. You can add several at once. A photo that is already in your library is skipped.

### Marking a cell

1. Open an image and click **Add cell** (or press `N`).
2. Choose how to draw in the toolbar:
   - **Points**: click around the outline. To finish, click the first point again, double-click, or press `Enter`. This is the most precise option.
   - **Freehand**: hold the mouse button down, trace all the way around, then let go. Quicker, but less precise.
3. **Step 1:** outline the **outer ring** (pink).
4. **Step 2:** outline the **dark center** (yellow).

The measurements appear on the right as soon as the cell is finished. The main number is the **median distance**.

### Fixing mistakes

- Click a cell to select it. Then:
  - drag its points to move them;
  - click on an outline to add a point;
  - press `Delete` to remove the selected point, or the whole cell if no point is selected.
- **Undo** and **Redo** are in the toolbar (`Ctrl+Z` / `Ctrl+Shift+Z`).

### Moving around the image

- Scroll to zoom.
- Drag the image to move it. In Freehand mode, use `Space`+drag or the scroll wheel instead.
- `F` fits the whole image on screen.

### Saving and finishing

- Your work saves automatically. The label at the top says **Saved** when everything is stored.
- Click **Mark as done** when you have finished an image.
- Use the arrows at the top (or the `←` / `→` keys) to go to the previous or next image.

### Sharing (online version)

Images are private to whoever uploaded them. On the Images page, hover over one of your images and click the share icon to share it with everyone signed in. Each person's cells are saved separately. As the image's owner, you can later review everyone's annotations of it.

### Display

The **Display** panel only changes how the photo looks on screen; the photo itself is never changed.

- **Green only** with **Boost contrast** often makes faint rings easier to see.
- **Reset to original** brings the photo back as it was taken.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `N` | Add cell |
| `D` | Switch between Points and Freehand |
| `Enter` | Finish the outline (Points mode) |
| `Backspace` | Remove the last point while drawing |
| `Esc` | Cancel the cell being drawn / deselect |
| `Delete` | Delete the selected point or cell |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `F` | Fit image to window |
| `G` | Cycle colour channel |
| `R` | Show or hide measurement lines |
| `←` / `→` | Previous / next image |

---

## For developers

Vite + TypeScript, no UI framework. Canvas 2D for rendering.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # type-check + production build into dist/
```

### Storage backends

The app chooses its storage when it is built ([src/storage/index.ts](src/storage/index.ts)):

| Env vars | Backend | Sign-in | Where data lives |
|---|---|---|---|
| not set | IndexedDB ([local.ts](src/storage/local.ts)) | none | this browser only |
| `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase ([supabase.ts](src/storage/supabase.ts)) | email link | Supabase Postgres + Storage |

Without the env vars everything works offline in one browser, which is handy for development. Browser storage can be cleared by the user, so use Supabase for real data collection.

### Setting up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query:** paste [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) and run it. This creates:
   - the `images` and `annotations` tables;
   - row-level security policies;
   - a private `images` storage bucket.
3. **Authentication → Sign In / Providers:** make sure **Email** is enabled.
4. **Authentication → URL Configuration:** add every address the app runs at to **Redirect URLs**, e.g. `http://localhost:5173` and `https://your-app.vercel.app`. Set **Site URL** to the production address.
5. **Project Settings → API Keys / Data API:** copy the project URL and the **publishable** key (`sb_publishable_…`; older projects call it the `anon` key) into `.env.local` (see [.env.example](.env.example)).

The publishable key is safe to expose in the browser. **Never** put the secret key (`sb_secret_…`) in a `VITE_` variable: those are bundled into the JavaScript every visitor downloads, and the secret key bypasses all access rules. This app never needs it. Access control is enforced by the row-level security policies in the migration:

- Images are visible to their owner, or to everyone signed in once `shared` is true.
- Each user reads and writes only their own annotations.
- An image's owner can also read others' annotations of that image.

Supabase's built-in email sender is rate-limited. For a class of students, configure a custom SMTP provider under **Authentication → Emails**.

### Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel: **Add New → Project**, then import the repository. [vercel.json](vercel.json) already sets the build.
3. Under **Settings → Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then redeploy.
4. Add the Vercel URL to Supabase's redirect URLs (step 4 above).

Alternatively, `npx vercel` from this folder deploys from the command line. Routing uses the URL hash (`#/library`, `#/image/<id>`), so no rewrite rules are needed.

### Code map

- **Screens**
  - `src/screens/`: `library.ts`, `annotate.ts`, `signin.ts`.
  - [src/main.ts](src/main.ts): hash router.
- **Canvas**
  - [viewport.ts](src/canvas/viewport.ts): image ↔ screen transform.
  - [filters.ts](src/canvas/filters.ts): display filters.
  - [render.ts](src/canvas/render.ts): drawing.
- **Tools**
  - [draw.ts](src/tools/draw.ts): point-by-point drawing.
  - [freehand.ts](src/tools/freehand.ts): stroke → smoothed and simplified polygon.
  - [edit.ts](src/tools/edit.ts): vertex hit-testing and edits.
  - [history.ts](src/history.ts): undo/redo.
- **Measurements**
  - [geometry.ts](src/measure/geometry.ts): polygon geometry.
  - [measure.ts](src/measure/measure.ts): ray-based gap with the pipeline's MAD outlier rule. `tests/measure.test.ts` includes numpy parity fixtures.
- **Data**
  - [schema.ts](src/io/schema.ts): annotation format (`schema_version: 1`; all coordinates in original image pixels).
  - [annotation.ts](src/io/annotation.ts): document ↔ editor state. Measurements are recomputed on load.
