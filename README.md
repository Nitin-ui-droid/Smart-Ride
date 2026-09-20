# RideMitra

RideMitra is a ride-sharing app prototype. The current version works as a browser-only demo using localStorage.

**Live Demo:** https://ride-mitra-ada4a.web.app

## Real app version

To make it a real multi-user app, connect it to Firebase or Supabase and replace the localStorage logic with a backend API.

### Recommended stack
- Firebase Auth for login/signup
- Firestore for users, rides, bookings, notifications
- Static hosting on Firebase Hosting or Netlify

### Required setup
1. Create a Firebase project.
2. Enable Email/Password auth.
3. Enable Firestore.
4. Add your config to firebase-config.js.
5. Replace the localStorage-based logic in app.js with Firebase calls.

### Local preview
Open the site in a browser via a local HTTP server:

```bash
python -m http.server 8000
```

Then visit:

http://localhost:8000

## Important note
This project is currently a frontend demo and not a production-ready multi-user app because it stores all data in the browser.
