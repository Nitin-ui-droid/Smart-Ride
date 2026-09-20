# Real backend migration plan

## Goal
Convert RideMitra from a browser-only localStorage prototype into a real multi-user app.

## Option A — Firebase (recommended)

### Auth
- Email/password signup/login
- Save user profile data after auth

### Firestore collections
- users
- rides
- bookings
- notifications
- settings

### Rules
- User can read/write only their own profile
- Driver can read/update their rides
- Passenger can read booking status and notifications
- Public ride listings are readable by all users

## Option B — Supabase

### Auth
- Email/password auth
- Row-level security policies

### Tables
- profiles
- rides
- bookings
- notifications

## Deployment
- Firebase Hosting or Netlify for frontend
- Supabase/Firebase remote database
- GitHub repo + CI/CD pipeline

## Needed files to change
- app.js
- login.html
- signup.html
- offer-ride.html
- find-ride.html
- dashboard.html
- account.html
- settings.html

## Current limitation
The current project is still a local demo due to browser-only storage and fake activation messaging. A real app requires backend services and shared state across users.
