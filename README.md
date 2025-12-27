# 👶 BebaLog

**BebaLog** is a lightweight, offline-first baby activity tracker built as a simple Progressive Web App (PWA).

It is a **client-only web application**, which means it needs to be hosted somewhere in order to be accessed — but it does **not** require any backend, server, or account.

Anyone can use it directly by visiting:

👉 **https://ltzel.github.io/bebalog**

All data is stored **locally in the browser** using IndexedDB.  
No data is sent to a server, and nothing is stored anywhere except the user’s own browser (e.g. Chrome, Firefox).

Once loaded, BebaLog works fully offline and can be used on a device like a native app.

---

# ❤️ Why BebaLog Exists

This project was created **for my wife**, to help her with the struggle of managing the daily routines of a newborn baby (our beba!).

During the first weeks (and months), everything blends together: feeds, diaper changes, timings, notes — all while running on little sleep.  
BebaLog was built to be **simple, fast, and reliable**, so she could focus on the baby instead of tracking details.

I didn’t research other tools or compare alternatives.  
This project exists for one reason only: **to help at home**.

If it happens to help other parents too, that’s a welcome bonus.

---

## 🤖 Acknowledgements
Built with ❤️, speed, and the help of modern tools — because time and sleep mattered.

---

## ✨ Features

### 🍼 Quick Logging
- Start / stop **feeding sessions**
- Log **wet**, **soiled**, or **both** diaper changes
- Undo last action
- Manual entry support

---

### 📊 Daily Status (Today)
Displayed at the top of the app:
- 💧 **Wet diapers today**
- 💩 **Soiled diapers today**
- 🍼 **Feeds today**

Counts are:
- Calculated from stored data
- Based on **local calendar day**
- Updated automatically on every refresh

---

### 📅 History (Split per Day)
- All entries are grouped by **date**
- Each day has a clear header (e.g. *Mon, 25 Mar 2025*)
- Events are ordered newest → oldest
- Individual entries can be deleted

---

### 📤 CSV Export
- Download all data as CSV
- Format:
  ```
  id,type,startTs,endTs,side,notes
  ```
- Oldest entries exported first
- Fully compatible with restore/import

---

### 📥 CSV Restore (Import)
- Restore data from a previously exported CSV
- Uses the **same format as export**
- Safe merge behavior:
  - Existing entries are kept
  - Duplicate IDs are skipped
  - Invalid rows are ignored

> ⚠️ Restore does **not** clear existing data by default

---

### 🔒 Offline-First & PWA
- Uses **IndexedDB** for storage
- Works fully offline
- Installable as a PWA
- Service Worker handles caching

---

## 🧠 Data Model

Each event has the following fields:

| Field     | Description |
|----------|-------------|
| `id`      | Auto-incremented numeric ID |
| `type`    | `feed`, `wet`, `soiled`, `both` |
| `startTs`| Start timestamp (ms) |
| `endTs`  | End timestamp (ms, optional) |
| `side`   | Feeding side (optional) |
| `notes`  | Free text notes |

---

## 🔁 CSV Format Example

```csv
id,type,startTs,endTs,side,notes
1,feed,1711376400000,1711378200000,left,
2,wet,1711379000000,,,
3,both,1711380000000,,,"Night diaper"
```

---

