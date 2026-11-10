# Cell Annotator

A web app for marking bacteria cells in microscope photos and measuring the distance from each cell's dark center to its outer ring. The measurements use the same method as the lab's neural-network pipeline (`measure_bacteria.py`, `inner2outer`), so hand annotations can be compared with the network's results.

---

## For annotators (doctors and students)

### Getting started

1. Open the app link you were given.
2. **Online version:** sign in in one of two ways:
   - **Email and password.** The first time, choose **Create account** and enter your name, email and a password (at least 6 characters). If the app asks you to confirm your email, click the link in that email, then sign in.
   - **Continue with Google**, if the button is shown. This uses your Google account; no new password is needed.
3. Your name is saved with every cell you mark. You can change it from the name button in the top-right corner.

Forgot your password? Type your email on the sign-in page and click **Forgot password?**. Open the email on the same computer, click the link, and choose a new password.

### Adding images

In the **Library**, click **Upload images or video** or drag photos onto the page. You can add several at once. A photo that is already in your library is skipped.

### Annotating frames from a video

A phone video has hundreds of frames, so instead of annotating them all you pick a few good ones.

1. Add the video (MP4 or MOV) the same way as a photo. The app reads it and checks every frame for sharpness, which takes a few seconds.
2. It suggests the sharpest frame in each part of the video: 10 by default, spread from start to end. The timeline shows each frame's sharpness; suggested frames are marked in blue.
3. Click the timeline (or use `←` / `→`, with `Shift` for ten frames) to look at other frames. **Use this frame** adds the one you're looking at, and × removes one. **Suggest again** picks a new set, with however many frames you ask for.
4. Check the phone name (taken from the file name) and, if you know it, the sensor pixel size. Then click **Save**.

Only the chosen frames are saved, as images, and the video file itself isn't kept. Each video gets its own card in the library; open it to see its frames and annotate them like any image. The arrows at the top move through the video's frames in order. To pick more frames later, open the video and click **Add frames**, then choose the same file again: frames you already saved are marked in green and won't be suggested twice.

Measurements stay in pixels. The pixel size is stored with the video but isn't used to convert to µm, because one image pixel on the specimen also depends on the microscope's magnification.

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
- `0` fits the whole image on screen.

### Checking an outline against the image

Press `F` (or the eye button in the toolbar) to hide all annotations and see the plain image; press it again to bring them back. Flipping back and forth shows how well each outline follows the cell. While the annotations are hidden you can still zoom and move around, but clicks don't change any cells.

### On a phone or tablet

The app works with touch. On a phone the tools sit along the bottom edge, and the cell list and settings slide up from the bottom: tap the **Cells** bar to open or close it.

- **Points:** tap around the outline. To finish, tap the first point again or press the ✓ button.
- **Freehand:** keep your finger down, trace all the way around, then lift it.
- **Zoom and move:** pinch with two fingers. Two fingers never add points, so you can zoom in the middle of drawing.
- **Fix a cell:** tap it to select it, then drag its points with your finger.

### Saving and finishing

- Your work saves automatically. The label at the top says **Saved** when everything is stored.
- Click **Mark as done** when you have finished an image.
- Use the arrows at the top (or the `←` / `→` keys) to go to the previous or next image.

### Exporting results

**Export** (in the library, or on a video's page) downloads what you have marked:

- **Measurements (CSV):** one row per cell, with where it came from (image, or video with phone, frame number and time) and every measurement. Opens in Excel or Google Sheets.
- **Outlines and measurements (JSON):** every annotation in full, including each outline's points, for comparing shapes with the network's output.

In the library, Export covers everything you can see (your images and videos, or the shared ones); on a video's page, just that video's frames. Only your own annotations are exported.

### Sharing (online version)

Images are private to whoever uploaded them. In the library, hover over one of your images and click the share icon to share it with everyone signed in. Each person's cells are saved separately. As the image's owner, you can later review everyone's annotations of it.

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
| `F` | Show / hide the annotations (compare with the plain image) |
| `0` | Fit image to window |
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
| `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase ([supabase.ts](src/storage/supabase.ts)) | email + password, optional Google | Supabase Postgres + Storage |

Without the env vars everything works offline in one browser, which is handy for development. Browser storage can be cleared by the user, so use Supabase for real data collection.

### Setting up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query:** paste [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) and run it. This creates:
   - the `images` and `annotations` tables;
   - row-level security policies;
   - a private `images` storage bucket.

   Then do the same with [supabase/migrations/0002_videos.sql](supabase/migrations/0002_videos.sql), which adds video support: a `videos` table, frame columns on `images`, and triggers that share a video's frames together with the video. Existing images and annotations are not changed. **Projects set up before videos existed need this step once**; until then the app works as before, and adding a video says the update is missing.
3. **Authentication → Sign In / Providers → Email:** make sure it is enabled.
   - **Confirm email** on (the default): new accounts must click a confirmation link before signing in.
   - **Confirm email** off: people can sign in straight after creating an account, and no sign-up emails are sent. This is simpler for a class, but anyone with the app link can create an account with any address.
4. **Authentication → URL Configuration:** add every address the app runs at to **Redirect URLs**, e.g. `http://localhost:5173`, `http://localhost:5179` and `https://your-app.vercel.app`. Set **Site URL** to the production address. Google sign-in, password-reset links and confirmation links only return to addresses on this list.
5. **Project Settings → API Keys / Data API:** copy the project URL and the **publishable** key (`sb_publishable_…`; older projects call it the `anon` key) into `.env.local` (see [.env.example](.env.example)).

The publishable key is safe to expose in the browser. **Never** put the secret key (`sb_secret_…`) in a `VITE_` variable: those are bundled into the JavaScript every visitor downloads, and the secret key bypasses all access rules. This app never needs it. Access control is enforced by the row-level security policies in the migration:

- Images are visible to their owner, or to everyone signed in once `shared` is true.
- Each user reads and writes only their own annotations.
- An image's owner can also read others' annotations of that image.

Supabase's built-in email sender is rate-limited to a few emails per hour. That limit covers confirmation and password-reset emails. For a class of students, configure a custom SMTP provider under **Authentication → Emails**, or turn **Confirm email** off.

### Turning on "Continue with Google" (optional)

The Google button appears on the sign-in page automatically once Google is enabled in Supabase.

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project.
2. **APIs & Services → OAuth consent screen:**
   - Choose **External**.
   - Fill in the app name and support email.
   - Add the scopes `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`.
   - Publish the app. Without publishing, only the test users you list can sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type: **Web application**.
   - **Authorized JavaScript origins:** every address the app runs at, e.g. `http://localhost:5179` and `https://your-app.vercel.app`.
   - **Authorized redirect URIs:** `https://<your-project-ref>.supabase.co/auth/v1/callback`. Supabase shows this exact URL on its Google provider page.
4. Copy the **Client ID** and **Client secret** into Supabase: **Authentication → Sign In / Providers → Google**, then enable it and save.

A Google user's display name comes from their Google profile. If someone uses Google once and email + password once with the same address, Supabase links them to the same account.

### Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel: **Add New → Project**, then import the repository. [vercel.json](vercel.json) already sets the build.
3. Under **Settings → Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then redeploy.
4. Add the Vercel URL to Supabase's redirect URLs (step 4 above).

Alternatively, `npx vercel` from this folder deploys from the command line. Routing uses the URL hash (`#/library`, `#/image/<id>`), so no rewrite rules are needed.

### Code map

Domain terms are defined in [GLOSSARY.md](GLOSSARY.md).

- **Screens** (DOM only; the logic lives in the modules below)
  - [main.ts](src/main.ts): hash router.
  - `src/screens/`: `library.ts`, `annotate.ts`, `signin.ts`, `video.ts` (a video's frames) and `frame-picker.ts` (choosing frames; loaded on demand through `pick-frames.ts`).
- **Annotating**
  - [annotation/session.ts](src/annotation/session.ts): the annotation session. Cells, the cell being drawn, selection, undo/redo, status and settings behind one interface; it decides what a tap or a drag means (place a point, close an outline, select, move or insert a point, trace). Every cell is re-measured on change. Tested in `tests/session.test.ts`.
  - Its internals, in the same folder: [draft.ts](src/annotation/draft.ts) (the cell being drawn), [freehand.ts](src/annotation/freehand.ts) (trace → simplified outline), [edit.ts](src/annotation/edit.ts) (point hit-testing and edits), [history.ts](src/annotation/history.ts) (undo snapshots).
- **Videos**
  - [video/clip.ts](src/video/clip.ts): opens an MP4/MOV (mp4box) and decodes frames exactly with WebCodecs, numbered in display order like OpenCV; scores every frame and keeps small previews.
  - [video/frames.ts](src/video/frames.ts): sharpness (variance of the Laplacian), suggestions spread over the clip, and names guessed from the file name. Pure; tested in `tests/frames.test.ts`.
- **Input**
  - [input/gestures.ts](src/input/gestures.ts): turns mouse, pen and touch events into taps, double-taps, drags, pans, pinches and hover. Pure; tested with timed event sequences in `tests/gestures.test.ts`.
- **Canvas**
  - [viewport.ts](src/canvas/viewport.ts): image ↔ screen transform, zoom, pan, pinch.
  - [filters.ts](src/canvas/filters.ts): display filters.
  - [render.ts](src/canvas/render.ts): draws a `Scene` (image, cells, selection, cell being drawn).
- **Measurements**
  - [geometry.ts](src/measure/geometry.ts): polygon geometry.
  - [measure.ts](src/measure/measure.ts): gap along measurement lines with the pipeline's MAD rule. `tests/measure.test.ts` includes numpy parity fixtures.
- **Data and storage**
  - [schema.ts](src/io/schema.ts): annotation format (`schema_version: 1`; all coordinates in original image pixels); [annotation.ts](src/io/annotation.ts): document ↔ content.
  - [storage/store.ts](src/storage/store.ts): the three interfaces a backend provides. `LibraryStore` (images, videos and their frames, annotations) and `Account` (the annotator's name) have two adapters each, [local.ts](src/storage/local.ts) (IndexedDB) and [supabase.ts](src/storage/supabase.ts). `Auth` (sign-in) exists only online.
  - [io/export.ts](src/io/export.ts): CSV and JSON export of annotations per image or video frame. Tested in `tests/export.test.ts`.
  - [storage/annotation-file.ts](src/storage/annotation-file.ts): opens an image's annotation and autosaves it (debounce, retry, timestamps; leaving an image waits for a save in progress, then saves the rest). Tested with an in-memory adapter in `tests/annotation-file.test.ts`.
