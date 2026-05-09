# Tab cleaner

Sometimes I'm using chrome browser, but I soooo match can't use it with the Opera close duplicate tabs feature, that I felt obligated to creat this extension to have anything helping me to fight off duplicate tabs.
  <img width="772" height="693" alt="Screenshot 2026-05-09 at 21 20 29" src="https://github.com/user-attachments/assets/1cd4679c-8ccb-4df4-a975-d889f4e9f1a9" />

## Debugging / Diagnostics

1. Load unpacked extension from this repository root directory.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Find **TabCleaner** and click the **service worker** link to open its console.
5. Click **Reload** on the extension.
6. Right-click the **TabCleaner extension action icon** in the Chrome toolbar.
7. Expected context menu:
   - `TabCleaner > Preview duplicate tabs`
   - `TabCleaner > Close duplicate tabs`
8. Check the service worker console for logs prefixed with `[TabCleaner]`.

The popup also includes a **Diagnostics** button that fetches and displays:
- service worker load timestamp
- last context menu setup status/error
- last badge update status
- current duplicate group count
