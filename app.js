/* =========================================================
   RIDEMITRA — STANDALONE APP LOGIC
   Everything runs in the browser. No server, no database —
   all data lives in this browser's localStorage. That means
   accounts/rides only exist on the device + browser they were
   created in (open the site in another browser and it starts
   fresh), which is expected for a client-side demo.
========================================================= */

"use strict";

const DB_KEYS = {
    USERS: "rm_users",
    SESSION: "rm_session",
    RIDES: "rm_rides",
    BOOKINGS: "rm_bookings",
    NOTIFICATIONS: "rm_notifications"
};

const APP_CONFIG = window.RIDE_APP_CONFIG || { useFirebase: false, firebaseConfig: {} };
let FIREBASE_READY = false;
let firebaseAuthReady = Promise.resolve(null);

function isFirebaseEnabled() {
    const cfg = APP_CONFIG.firebaseConfig || {};
    const hasProject = !!(cfg.apiKey && cfg.projectId && cfg.appId);
    return Boolean(APP_CONFIG.useFirebase && hasProject && window.firebase);
}

function ensureFirebase() {
    if (!isFirebaseEnabled()) return false;
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(APP_CONFIG.firebaseConfig);
        }
        firebaseAuthReady = new Promise(resolve => {
            const unsubscribe = firebase.auth().onAuthStateChanged(user => {
                unsubscribe();
                resolve(user);
            });
        });
        FIREBASE_READY = true;
        return true;
    } catch (error) {
        console.warn("RideMitra: Firebase initialization failed.", error);
        FIREBASE_READY = false;
        return false;
    }
}

/* =========================================================
   LOW-LEVEL STORAGE HELPERS
========================================================= */

function readList(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
    } catch (error) {
        console.error(`RideMitra: could not read ${key}`, error);
        return [];
    }
}

function writeList(key, list) {
    try {
        localStorage.setItem(key, JSON.stringify(list));
        return true;
    } catch (error) {
        console.error(`RideMitra: could not write ${key}`, error);
        return false;
    }
}

function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* =========================================================
   HELPERS
========================================================= */

function escapeHTML(value = "") {
    const div = document.createElement("div");
    div.textContent = String(value);
    return div.innerHTML;
}

function formatCurrency(amount) {
    const value = Number(amount) || 0;
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0
    }).format(value);
}

function formatDate(value) {
    if (!value) return "Not specified";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-IN", {
        day: "numeric", month: "short", year: "numeric"
    }).format(date);
}

function initPasswordToggle(buttonId, input) {
    const btn = document.getElementById(buttonId);
    if (!btn || !input) return;
    btn.addEventListener("click", () => {
        const hidden = input.type === "password";
        input.type = hidden ? "text" : "password";
        btn.textContent = hidden ? "Hide" : "Show";
    });
}

function showToast(message, type = "info") {
    let toast = document.getElementById("rmToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "rmToast";
        document.body.appendChild(toast);
    }
    const colors = {
        success: "#5fd88a",
        error: "#ff5c5c",
        warning: "#ffb444",
        info: "#ff6a1a"
    };
    toast.style.background = colors[type] || colors.info;
    toast.textContent = message;
    requestAnimationFrame(() => {
        toast.style.transform = "translateY(0)";
        toast.style.opacity = "1";
    });
    clearTimeout(window._rmToastTimer);
    window._rmToastTimer = setTimeout(() => {
        toast.style.transform = "translateY(20px)";
        toast.style.opacity = "0";
    }, 3200);
}

/* =========================================================
   USERS + SESSION
   (Passwords are only lightly obscured with base64 — this is
   a browser-only demo with no server, so it is not meant to
   be real security. app.py in the repo shows how this project
   does proper server-side hashing when a backend is used.)
========================================================= */

function obscure(password) {
    return btoa(unescape(encodeURIComponent(password)));
}

function getUsers() {
    if (isFirebaseEnabled() && firebase.firestore) {
        return readList(DB_KEYS.USERS);
    }
    return readList(DB_KEYS.USERS);
}

function findUserByEmail(email) {
    const normalized = email.trim().toLowerCase();
    return getUsers().find(u => u.email === normalized) || null;
}

async function registerUser({ name, email, phone, password }) {
    const normalizedEmail = email.trim().toLowerCase();
    if (isFirebaseEnabled() && firebase.auth && firebase.firestore) {
        try {
            const cred = await firebase.auth().createUserWithEmailAndPassword(normalizedEmail, password);
            const user = {
                userId: cred.user.uid,
                name: name.trim(),
                email: normalizedEmail,
                phone: phone.trim(),
                password: obscure(password),
                createdAt: new Date().toISOString()
            };
            await firebase.firestore().collection("users").doc(cred.user.uid).set(user);
            localStorage.setItem(DB_KEYS.SESSION, cred.user.uid);
            return { success: true, user };
        } catch (error) {
            return { success: false, message: error?.message || "Unable to create account." };
        }
    }

    if (findUserByEmail(normalizedEmail)) {
        return { success: false, message: "An account with this email already exists." };
    }

    const users = getUsers();
    const user = {
        userId: newId("user"),
        name: name.trim(),
        email: normalizedEmail,
        phone: phone.trim(),
        password: obscure(password),
        createdAt: new Date().toISOString()
    };
    users.push(user);
    writeList(DB_KEYS.USERS, users);

    localStorage.setItem(DB_KEYS.SESSION, user.userId);
    return { success: true, user };
}

async function loginUser(email, password) {
    if (isFirebaseEnabled() && firebase.auth) {
        try {
            const normalizedEmail = email.trim().toLowerCase();
            const cred = await firebase.auth().signInWithEmailAndPassword(normalizedEmail, password);
            const userDoc = await firebase.firestore().collection("users").doc(cred.user.uid).get();
            const user = userDoc.exists ? userDoc.data() : {
                userId: cred.user.uid,
                name: cred.user.displayName || "Rider",
                email: cred.user.email,
                phone: "",
                password: "",
                createdAt: new Date().toISOString()
            };
            const cachedUsers = getUsers();
            const cachedUser = { ...user, password: "" };
            const cachedIndex = cachedUsers.findIndex(item => item.userId === cachedUser.userId);
            if (cachedIndex >= 0) cachedUsers[cachedIndex] = cachedUser;
            else cachedUsers.push(cachedUser);
            writeList(DB_KEYS.USERS, cachedUsers);
            localStorage.setItem(DB_KEYS.SESSION, cred.user.uid);
            return { success: true, user };
        } catch (error) {
            const messages = {
                "auth/invalid-credential": "Email or password is incorrect. Check both fields or use Forgot password.",
                "auth/user-not-found": "No account exists for this email. Create an account first.",
                "auth/wrong-password": "Password is incorrect. Use Forgot password to reset it.",
                "auth/invalid-email": "Please enter a valid email address.",
                "auth/user-disabled": "This account has been disabled in Firebase."
            };
            return { success: false, message: messages[error?.code] || error?.message || "Unable to log in." };
        }
    }

    const user = findUserByEmail(email);

    if (!user || user.password !== obscure(password)) {
        return { success: false, message: "Invalid email or password." };
    }

    localStorage.setItem(DB_KEYS.SESSION, user.userId);
    return { success: true, user };
}

async function logoutUser(redirect = true) {
    if (isFirebaseEnabled() && firebase.auth) {
        await firebase.auth().signOut();
    }
    localStorage.removeItem(DB_KEYS.SESSION);
    if (redirect) window.location.href = "login.html";
}

function getCurrentUser() {
    const userId = localStorage.getItem(DB_KEYS.SESSION);
    const firebaseUser = isFirebaseEnabled() && firebase.auth ? firebase.auth().currentUser : null;
    if (isFirebaseEnabled() && !firebaseUser) return null;
    const activeUserId = isFirebaseEnabled() ? firebaseUser.uid : userId;
    if (!activeUserId) return null;
    const user = getUsers().find(u => u.userId === activeUserId);
    if (!user && firebaseUser) {
        return {
            userId: firebaseUser.uid,
            name: firebaseUser.displayName || "Rider",
            email: firebaseUser.email || "",
            phone: firebaseUser.phoneNumber || "",
            password: "",
            createdAt: new Date().toISOString()
        };
    }
    return user || null;
}

function isLoggedIn() {
    return !!getCurrentUser();
}

/* =========================================================
   RIDES
========================================================= */

function getAllRides() {
    return readList(DB_KEYS.RIDES);
}

function getAvailableRides() {
    return getAllRides().filter(r => r.status === "available");
}

async function getAllRidesAsync() {
    if (isFirebaseEnabled() && firebase.firestore) {
        const snapshot = await firebase.firestore().collection("rides").get();
        return snapshot.docs.map(doc => doc.data()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    }
    return getAllRides();
}

async function getAvailableRidesAsync() {
    return (await getAllRidesAsync()).filter(r => r.status === "available");
}

async function getRidesForPassengerAsync() {
    const rides = await getAllRidesAsync();
    let bookings = [];
    try {
        bookings = await getPassengerBookingsAsync();
    } catch (error) {
        console.warn("RideMitra: passenger bookings are unavailable while loading rides.", error);
        return rides.filter(ride => ride.status === "available");
    }
    const activeRideIds = new Set(bookings
        .filter(booking => ["pending", "accepted"].includes(booking.status || "pending"))
        .map(booking => booking.rideId));
    return rides.filter(ride => ride.status === "available" || activeRideIds.has(ride.rideId));
}

async function publishRide({ from, to, date, time, seats, price, vehicle }) {
    const driver = getCurrentUser();
    if (!driver) return { success: false, message: "Please login before publishing a ride." };

    const firebaseUser = isFirebaseEnabled() && firebase.auth ? firebase.auth().currentUser : null;
    if (isFirebaseEnabled() && !firebaseUser) {
        return { success: false, message: "Your Firebase session has expired. Please log in again." };
    }

    if (from.trim().toLowerCase() === to.trim().toLowerCase()) {
        return { success: false, message: "Starting location and destination cannot be the same." };
    }
    if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
        return { success: false, message: "Seats must be between 1 and 8." };
    }
    if (!(price >= 0)) {
        return { success: false, message: "Please enter a valid price." };
    }

    const rides = getAllRides();
    const ride = {
        rideId: newId("ride"),
        driverId: firebaseUser ? firebaseUser.uid : driver.userId,
        driverName: driver.name,
        from: from.trim(),
        to: to.trim(),
        date,
        time,
        seats,
        availableSeats: seats,
        price: Number(price),
        vehicle: vehicle.trim(),
        status: "available",
        createdAt: new Date().toISOString()
    };

    if (isFirebaseEnabled() && firebase.firestore) {
        try {
            await firebase.firestore().collection("rides").doc(ride.rideId).set(ride);
            return { success: true, ride };
        } catch (error) {
            if (error?.code === "permission-denied") {
                return { success: false, message: "Firebase permission denied. Please log out, log in again, and publish the ride." };
            }
            return { success: false, message: error?.message || "Unable to publish ride." };
        }
    }

    rides.unshift(ride);
    writeList(DB_KEYS.RIDES, rides);

    return { success: true, ride };
}

function findRide(rideId) {
    return getAllRides().find(r => r.rideId === rideId) || null;
}

async function findRideAsync(rideId) {
    if (isFirebaseEnabled() && firebase.firestore) {
        const snapshot = await firebase.firestore().collection("rides").doc(rideId).get();
        return snapshot.exists ? snapshot.data() : null;
    }
    return findRide(rideId);
}

async function deleteRide(rideId) {
    const driver = getCurrentUser();
    if (!driver || !rideId) return { success: false, message: "Please log in to delete a ride." };

    if (isFirebaseEnabled() && firebase.firestore) {
        try {
            const rideRef = firebase.firestore().collection("rides").doc(rideId);
            const snapshot = await rideRef.get();
            if (!snapshot.exists || snapshot.data().driverId !== driver.userId) {
                return { success: false, message: "You can only delete your own rides." };
            }
            await rideRef.delete();
            return { success: true };
        } catch (error) {
            return { success: false, message: error?.message || "Unable to delete ride." };
        }
    }

    const rides = getAllRides();
    const ride = rides.find(item => item.rideId === rideId && item.driverId === driver.userId);
    if (!ride) return { success: false, message: "You can only delete your own rides." };
    writeList(DB_KEYS.RIDES, rides.filter(item => item.rideId !== rideId));
    return { success: true };
}

async function searchRides({ from = "", to = "", date = "" }) {
    from = from.trim().toLowerCase();
    to = to.trim().toLowerCase();

    return (await getRidesForPassengerAsync()).filter(ride => {
        const fromMatch = !from || ride.from.toLowerCase().includes(from);
        const toMatch = !to || ride.to.toLowerCase().includes(to);
        const dateMatch = !date || ride.date === date;
        return fromMatch && toMatch && dateMatch;
    });
}

/* =========================================================
   BOOKINGS + NOTIFICATIONS
========================================================= */

function getAllBookings() {
    return readList(DB_KEYS.BOOKINGS);
}

async function getAllBookingsAsync() {
    if (isFirebaseEnabled() && firebase.firestore) {
        const user = getCurrentUser();
        if (!user) return [];
        const snapshot = await firebase.firestore().collection("bookings")
            .where("passengerId", "==", user.userId).get();
        return snapshot.docs.map(doc => doc.data());
    }
    return getAllBookings();
}

async function getPassengerBookingsAsync() {
    const user = getCurrentUser();
    if (!user) return [];
    if (isFirebaseEnabled() && firebase.firestore) {
        const snapshot = await firebase.firestore().collection("bookings")
            .where("passengerId", "==", user.userId).get();
        return snapshot.docs.map(doc => doc.data());
    }
    return getAllBookings().filter(booking => booking.passengerId === user.userId);
}

function getNotifications(userId) {
    return readList(DB_KEYS.NOTIFICATIONS).filter(n => n.userId === userId);
}

async function getNotificationsAsync(userId) {
    if (isFirebaseEnabled() && firebase.firestore) {
        const snapshot = await firebase.firestore().collection("notifications")
            .where("userId", "==", userId).get();
        return snapshot.docs.map(doc => doc.data()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    }
    return getNotifications(userId);
}

async function pushNotification({ userId, message, rideId, bookingId, type }) {
    const notification = {
        id: newId("notif"),
        userId,
        rideId,
        bookingId: bookingId || null,
        type: type || null,
        message,
        isRead: false,
        createdAt: new Date().toISOString()
    };
    if (isFirebaseEnabled() && firebase.firestore) {
        await firebase.firestore().collection("notifications").doc(notification.id).set(notification);
        return;
    }
    const notifications = readList(DB_KEYS.NOTIFICATIONS);
    notifications.unshift(notification);
    writeList(DB_KEYS.NOTIFICATIONS, notifications);
}

async function markNotificationsRead(userId) {
    if (isFirebaseEnabled() && firebase.firestore) {
        const snapshot = await firebase.firestore().collection("notifications")
            .where("userId", "==", userId).where("isRead", "==", false).get();
        const batch = firebase.firestore().batch();
        snapshot.docs.forEach(doc => batch.update(doc.ref, { isRead: true }));
        if (!snapshot.empty) await batch.commit();
        return;
    }
    const notifications = readList(DB_KEYS.NOTIFICATIONS);
    notifications.forEach(n => { if (n.userId === userId) n.isRead = true; });
    writeList(DB_KEYS.NOTIFICATIONS, notifications);
}

async function deleteNotification(notificationId) {
    const user = getCurrentUser();
    if (!user || !notificationId) return { success: false, message: "Unable to delete notification." };

    if (isFirebaseEnabled() && firebase.firestore) {
        try {
            await firebase.firestore().collection("notifications").doc(notificationId).delete();
            return { success: true };
        } catch (error) {
            return { success: false, message: error?.message || "Unable to delete notification." };
        }
    }

    const notifications = readList(DB_KEYS.NOTIFICATIONS);
    writeList(DB_KEYS.NOTIFICATIONS, notifications.filter(notification => notification.id !== notificationId));
    return { success: true };
}

async function bookRide(rideId, seatsBooked = 1) {
    const passenger = getCurrentUser();
    if (!passenger) return { success: false, message: "Please login to book a ride." };

    if (isFirebaseEnabled() && firebase.firestore) {
        try {
            const db = firebase.firestore();
            const rideRef = db.collection("rides").doc(rideId);
            const bookingId = `${rideId}_${passenger.userId}`;
            const bookingRef = db.collection("bookings").doc(bookingId);
            let booking;

            await db.runTransaction(async transaction => {
                const rideSnapshot = await transaction.get(rideRef);
                const bookingSnapshot = await transaction.get(bookingRef);
                if (!rideSnapshot.exists) throw new Error("Ride no longer exists.");
                const ride = rideSnapshot.data();
                if (ride.driverId === passenger.userId) throw new Error("You cannot book your own ride.");
                if (bookingSnapshot.exists && bookingSnapshot.data().status !== "cancelled") {
                    throw new Error("You have already booked this ride.");
                }
                if (ride.availableSeats < seatsBooked) throw new Error("Not enough seats available.");

                booking = {
                    bookingId,
                    rideId,
                    driverId: ride.driverId,
                    passengerId: passenger.userId,
                    passengerName: passenger.name,
                    seatsBooked,
                    from: ride.from,
                    to: ride.to,
                    date: ride.date,
                    time: ride.time,
                    price: ride.price,
                    status: "pending",
                    createdAt: new Date().toISOString()
                };
                const availableSeats = ride.availableSeats - seatsBooked;
                transaction.update(rideRef, {
                    availableSeats,
                    status: availableSeats <= 0 ? "booked" : "available"
                });
                if (bookingSnapshot.exists) {
                    transaction.update(bookingRef, booking);
                } else {
                    transaction.set(bookingRef, booking);
                }
            });

            await pushNotification({
                userId: booking.driverId,
                rideId,
                bookingId: booking.bookingId,
                type: "booking-request",
                message: `${passenger.name} requested ${booking.seatsBooked} seat${booking.seatsBooked > 1 ? "s" : ""} for ${booking.from} to ${booking.to} on ${formatDate(booking.date)} at ${booking.time || "the scheduled time"}. Fare: ${formatCurrency(booking.price * booking.seatsBooked)}.`
            });
            return { success: true, booking };
        } catch (error) {
            return { success: false, message: error?.message || "Unable to book ride." };
        }
    }

    const rides = getAllRides();
    const ride = rides.find(r => r.rideId === rideId);
    if (!ride) return { success: false, message: "Ride no longer exists." };

    if (ride.driverId === passenger.userId) {
        return { success: false, message: "You cannot book your own ride." };
    }
    if (ride.availableSeats < seatsBooked) {
        return { success: false, message: "Not enough seats available." };
    }

    const bookings = getAllBookings();
    const alreadyBooked = bookings.some(b =>
        b.rideId === rideId
        && b.passengerId === passenger.userId
        && b.status !== "cancelled"
    );
    if (alreadyBooked) {
        return { success: false, message: "You have already booked this ride." };
    }

    const booking = {
        bookingId: newId("booking"),
        rideId,
        driverId: ride.driverId,
        passengerId: passenger.userId,
        passengerName: passenger.name,
        seatsBooked,
        from: ride.from,
        to: ride.to,
        date: ride.date,
        time: ride.time,
        price: ride.price,
        status: "pending",
        createdAt: new Date().toISOString()
    };
    bookings.push(booking);
    writeList(DB_KEYS.BOOKINGS, bookings);

    ride.availableSeats -= seatsBooked;
    if (ride.availableSeats <= 0) ride.status = "booked";
    writeList(DB_KEYS.RIDES, rides);

    // Notify the driver — this is the part that never existed before.
    pushNotification({
        userId: ride.driverId,
        rideId,
        bookingId: booking.bookingId,
        type: "booking-request",
        message: `${passenger.name} requested ${seatsBooked} seat${seatsBooked > 1 ? "s" : ""} for ${ride.from} to ${ride.to} on ${formatDate(ride.date)} at ${ride.time || "the scheduled time"}. Fare: ${formatCurrency(ride.price * seatsBooked)}.`
    });

    return { success: true, booking };
}

async function cancelBooking(rideId) {
    const passenger = getCurrentUser();
    if (!passenger) return { success: false, message: "Please login to cancel a booking." };

    if (isFirebaseEnabled() && firebase.firestore) {
        try {
            const db = firebase.firestore();
            const bookingRef = db.collection("bookings").doc(`${rideId}_${passenger.userId}`);
            const rideRef = db.collection("rides").doc(rideId);
            let booking;
            await db.runTransaction(async transaction => {
                const bookingSnapshot = await transaction.get(bookingRef);
                const rideSnapshot = await transaction.get(rideRef);
                if (!bookingSnapshot.exists) throw new Error("Booking not found.");
                if (!rideSnapshot.exists) throw new Error("Ride no longer exists.");
                booking = bookingSnapshot.data();
                if (booking.passengerId !== passenger.userId) throw new Error("You cannot cancel this booking.");
                if (!["pending", "accepted"].includes(booking.status || "pending")) {
                    throw new Error("This booking cannot be cancelled.");
                }
                const ride = rideSnapshot.data();
                const availableSeats = Math.min(ride.seats, ride.availableSeats + booking.seatsBooked);
                transaction.update(rideRef, { availableSeats, status: "available" });
                transaction.update(bookingRef, { status: "cancelled", cancelledAt: new Date().toISOString() });
            });
            await pushNotification({
                userId: booking.driverId,
                rideId,
                message: `${passenger.name} cancelled their booking on your ride.`
            });
            return { success: true };
        } catch (error) {
            if (error?.code === "permission-denied") {
                return { success: false, message: "Cancellation permission denied. Publish the latest Firestore rules, then try again." };
            }
            return { success: false, message: error?.message || "Unable to cancel booking." };
        }
    }

    const bookings = getAllBookings();
    const booking = bookings.find(item => item.rideId === rideId && item.passengerId === passenger.userId);
    const rides = getAllRides();
    const ride = rides.find(item => item.rideId === rideId);
    if (!booking || !ride) return { success: false, message: "Booking not found." };
    if (!["pending", "accepted", undefined].includes(booking.status)) return { success: false, message: "This booking cannot be cancelled." };
    booking.status = "cancelled";
    ride.availableSeats = Math.min(ride.seats, ride.availableSeats + booking.seatsBooked);
    ride.status = "available";
    writeList(DB_KEYS.BOOKINGS, bookings);
    writeList(DB_KEYS.RIDES, rides);
    await pushNotification({ userId: booking.driverId, rideId, message: `${passenger.name} cancelled their booking on your ride.` });
    return { success: true };
}

async function getBookingRequestsAsync() {
    const driver = getCurrentUser();
    if (!driver) return [];
    if (isFirebaseEnabled() && firebase.firestore) {
        const snapshot = await firebase.firestore().collection("bookings")
            .where("driverId", "==", driver.userId).get();
        return snapshot.docs.map(doc => doc.data()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    }
    return getAllBookings().filter(booking => booking.driverId === driver.userId);
}

async function updateBookingStatus(bookingId, nextStatus) {
    const driver = getCurrentUser();
    if (!driver || !["accepted", "declined"].includes(nextStatus)) {
        return { success: false, message: "Invalid booking action." };
    }

    if (isFirebaseEnabled() && firebase.firestore) {
        try {
            const db = firebase.firestore();
            const bookingRef = db.collection("bookings").doc(bookingId);
            let booking;
            await db.runTransaction(async transaction => {
                const bookingSnapshot = await transaction.get(bookingRef);
                if (!bookingSnapshot.exists) throw new Error("Booking no longer exists.");
                booking = bookingSnapshot.data();
                if (booking.driverId !== driver.userId) throw new Error("You cannot manage this booking.");
                if (booking.status !== "pending") throw new Error("This booking has already been processed.");

                if (nextStatus === "declined") {
                    const rideRef = db.collection("rides").doc(booking.rideId);
                    const rideSnapshot = await transaction.get(rideRef);
                    if (rideSnapshot.exists) {
                        const ride = rideSnapshot.data();
                        const availableSeats = ride.availableSeats + booking.seatsBooked;
                        transaction.update(rideRef, {
                            availableSeats,
                            status: "available"
                        });
                    }
                }
                transaction.update(bookingRef, { status: nextStatus, processedAt: new Date().toISOString() });
            });

            await pushNotification({
                userId: booking.passengerId,
                rideId: booking.rideId,
                message: nextStatus === "accepted"
                    ? "Your ride booking request was accepted by the driver."
                    : "Your ride booking request was declined by the driver."
            });
            return { success: true };
        } catch (error) {
            return { success: false, message: error?.message || "Unable to update booking." };
        }
    }

    const bookings = getAllBookings();
    const booking = bookings.find(item => item.bookingId === bookingId);
    if (!booking || booking.driverId !== driver.userId) return { success: false, message: "Booking not found." };
    if (booking.status && booking.status !== "pending") return { success: false, message: "This booking has already been processed." };
    booking.status = nextStatus;
    if (nextStatus === "declined") {
        const rides = getAllRides();
        const ride = rides.find(item => item.rideId === booking.rideId);
        if (ride) {
            ride.availableSeats += booking.seatsBooked;
            ride.status = "available";
            writeList(DB_KEYS.RIDES, rides);
        }
    }
    writeList(DB_KEYS.BOOKINGS, bookings);
    pushNotification({
        userId: booking.passengerId,
        rideId: booking.rideId,
        message: nextStatus === "accepted"
            ? "Your ride booking request was accepted by the driver."
            : "Your ride booking request was declined by the driver."
    });
    return { success: true };
}

async function deleteBookingRequest(bookingId) {
    const driver = getCurrentUser();
    if (!driver || !bookingId) return { success: false, message: "Unable to remove booking request." };

    if (isFirebaseEnabled() && firebase.firestore) {
        try {
            const db = firebase.firestore();
            const bookingRef = db.collection("bookings").doc(bookingId);
            let booking;
            await db.runTransaction(async transaction => {
                const bookingSnapshot = await transaction.get(bookingRef);
                if (!bookingSnapshot.exists) throw new Error("Booking request no longer exists.");
                booking = bookingSnapshot.data();
                if (booking.driverId !== driver.userId) throw new Error("You cannot remove this booking request.");
                if (booking.status && booking.status !== "pending") throw new Error("This booking request is already processed.");

                const rideRef = db.collection("rides").doc(booking.rideId);
                const rideSnapshot = await transaction.get(rideRef);
                if (rideSnapshot.exists) {
                    const ride = rideSnapshot.data();
                    transaction.update(rideRef, {
                        availableSeats: Math.min(ride.seats, ride.availableSeats + booking.seatsBooked),
                        status: "available"
                    });
                }
                transaction.delete(bookingRef);
            });

            const notificationSnapshot = await db.collection("notifications")
                .where("userId", "==", driver.userId).get();
            const batch = db.batch();
            const requestNotifications = notificationSnapshot.docs.filter(doc => doc.data().bookingId === bookingId);
            requestNotifications.forEach(doc => batch.delete(doc.ref));
            if (requestNotifications.length) await batch.commit();
            return { success: true };
        } catch (error) {
            return { success: false, message: error?.message || "Unable to remove booking request." };
        }
    }

    const bookings = getAllBookings();
    const booking = bookings.find(item => item.bookingId === bookingId && item.driverId === driver.userId);
    if (!booking) return { success: false, message: "Booking request not found." };
    if (booking.status && booking.status !== "pending") return { success: false, message: "This booking request is already processed." };
    const rides = getAllRides();
    const ride = rides.find(item => item.rideId === booking.rideId);
    if (ride) {
        ride.availableSeats = Math.min(ride.seats, ride.availableSeats + booking.seatsBooked);
        ride.status = "available";
        writeList(DB_KEYS.RIDES, rides);
    }
    writeList(DB_KEYS.BOOKINGS, bookings.filter(item => item.bookingId !== bookingId));
    const notifications = readList(DB_KEYS.NOTIFICATIONS);
    writeList(DB_KEYS.NOTIFICATIONS, notifications.filter(item => item.bookingId !== bookingId));
    return { success: true };
}

/* =========================================================
   PAGE GUARDS
========================================================= */

function protectPage() {
    if (document.body.dataset.auth === "required" && !isLoggedIn()) {
        window.location.href = "login.html";
    }
}

function redirectAuthenticatedUser() {
    if (document.body.dataset.auth === "guest" && isLoggedIn()) {
        window.location.href = "dashboard.html";
    }
}

/* =========================================================
   SIGNUP FORM
========================================================= */

function initSignupForm() {
    const form = document.getElementById("signupForm");
    if (!form) return;

    const nameInput = document.getElementById("signupName");
    const emailInput = document.getElementById("signupEmail");
    const phoneInput = document.getElementById("signupPhone");
    const passwordInput = document.getElementById("signupPassword");
    const message = document.getElementById("signupMessage");
    const submitBtn = form.querySelector("button[type=submit]");

    phoneInput?.addEventListener("input", function () {
        this.value = this.value.replace(/\D/g, "").slice(0, 10);
    });

    initPasswordToggle("signupPasswordToggle", passwordInput);

    form.addEventListener("submit", async function (event) {
        event.preventDefault();

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const phone = phoneInput.value.trim();
        const password = passwordInput.value;

        if (name.length < 2) return setMsg("Please enter your full name.");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg("Please enter a valid email address.");
        if (!/^\d{10}$/.test(phone)) return setMsg("Enter a valid 10-digit phone number.");
        if (password.length < 6) return setMsg("Password must contain at least 6 characters.");

        const result = await registerUser({ name, email, phone, password });
        if (!result.success) return setMsg(result.message);

        setMsg("Account created. Redirecting to login\u2026", true);
        submitBtn.disabled = true;
        setTimeout(() => window.location.href = "login.html", 800);

        function setMsg(text, ok = false) {
            if (message) {
                message.textContent = text;
                message.style.color = ok ? "#5fd88a" : "#ff5c5c";
            }
        }
    });
}

/* =========================================================
   LOGIN FORM
========================================================= */

function initLoginForm() {
    const form = document.getElementById("loginForm");
    if (!form) return;

    const emailInput = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    const message = document.getElementById("loginMessage");
    const submitBtn = document.getElementById("loginSubmitBtn");
    const forgotPasswordLink = document.getElementById("forgotPasswordLink");
    const resetPanel = document.getElementById("resetPasswordPanel");
    const resetEmailInput = document.getElementById("resetEmail");
    const resetPasswordBtn = document.getElementById("resetPasswordBtn");
    const resetCancelBtn = document.getElementById("resetCancelBtn");

    initPasswordToggle("loginPasswordToggle", passwordInput);

    function setMsg(text, ok = false) {
        if (message) {
            message.textContent = text;
            message.style.color = ok ? "#5fd88a" : "#ff5c5c";
        }
    }

    forgotPasswordLink?.addEventListener("click", async function (event) {
        event.preventDefault();
        if (resetPanel) resetPanel.hidden = false;
        if (resetEmailInput) {
            resetEmailInput.value = emailInput?.value.trim() || "";
            resetEmailInput.focus();
        }
    });

    resetCancelBtn?.addEventListener("click", function () {
        if (resetPanel) resetPanel.hidden = true;
        setMsg("");
    });

    resetPasswordBtn?.addEventListener("click", async function () {
        const email = (resetEmailInput?.value || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setMsg("Please enter a valid email address.");
            return;
        }
        if (!isFirebaseEnabled() || !firebase.auth) {
            setMsg("Password reset is available only when Firebase Email/Password auth is enabled.");
            return;
        }

        try {
            resetPasswordBtn.disabled = true;
            await firebase.auth().sendPasswordResetEmail(email);
            setMsg("Password reset email sent successfully. Check your inbox.", true);
        } catch (error) {
            setMsg(error?.message || "Unable to send reset email.");
        } finally {
            resetPasswordBtn.disabled = false;
        }
    });

    form.addEventListener("submit", async function (event) {
        event.preventDefault();

        const email = (emailInput?.value || "").trim().toLowerCase();
        const password = passwordInput?.value || "";

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg("Please enter a valid email address.");
        if (!password) return setMsg("Please enter your password.");
        if (!isFirebaseEnabled() || !firebase.auth) return setMsg("Firebase Email/Password Auth is not enabled yet.");

        try {
            setMsg("Logging in...", true);
            submitBtn.disabled = true;
            const result = await loginUser(email, password);
            if (!result.success) throw new Error(result.message);

            setMsg("Login successful. Opening dashboard...", true);
            setTimeout(() => window.location.href = "dashboard.html", 500);
        } catch (error) {
            setMsg(error?.message || "Unable to log in.");
            submitBtn.disabled = false;
        }
    });
}

/* =========================================================
   SHARED APP-SHELL UI (sidebar, user chip, notifications)
========================================================= */

function initUserChip() {
    const user = getCurrentUser();
    if (!user) return;

    document.querySelectorAll("[data-user-name]").forEach(el => el.textContent = user.name);
    document.querySelectorAll("[data-user-email]").forEach(el => el.textContent = user.email);
    document.querySelectorAll("[data-user-initial]").forEach(el => el.textContent = (user.name || "U").charAt(0).toUpperCase());
    document.querySelectorAll("[data-logout]").forEach(btn => btn.addEventListener("click", () => logoutUser(true)));
}

function initMobileSidebar() {
    const toggle = document.getElementById("menuToggle");
    const sideNav = document.getElementById("sideNav");
    const overlay = document.getElementById("sidebarOverlay");
    if (!toggle || !sideNav) return;

    function close() {
        sideNav.classList.remove("open");
        overlay?.classList.remove("active");
    }
    toggle.addEventListener("click", () => {
        sideNav.classList.toggle("open");
        overlay?.classList.toggle("active");
    });
    overlay?.addEventListener("click", close);
}

function initActiveNav() {
    const current = window.location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll("a[href]").forEach(link => {
        if (link.getAttribute("href") === current) link.classList.add("active");
    });
}

function initLandingNav() {
    const toggle = document.getElementById("landingMenuToggle");
    const nav = document.querySelector(".topbar .nav-links");
    if (!toggle || !nav) return;

    toggle.addEventListener("click", () => {
        const open = nav.classList.toggle("mobile-open");
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    });

    nav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
        nav.classList.remove("mobile-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open navigation");
    }));
}

function initNotifications() {
    const user = getCurrentUser();
    if (!user) return;

    async function render() {
        const notifs = await getNotificationsAsync(user.userId);
        const bookingRequests = await getBookingRequestsAsync();
        const unread = notifs.filter(n => !n.isRead);

        document.querySelectorAll("[data-notification-count]").forEach(el => {
            el.textContent = unread.length;
            el.style.display = unread.length ? "flex" : "none";
        });

        const list = document.getElementById("notificationList");
        if (list) {
            list.innerHTML = notifs.length
                ? notifs.slice(0, 10).map(n => {
                    const request = bookingRequests.find(item =>
                        (!item.status || item.status === "pending")
                        && ((n.bookingId && item.bookingId === n.bookingId)
                            || (!n.bookingId && n.rideId && item.rideId === n.rideId))
                    );
                    const isBookingRequest = request
                        && (n.type === "booking-request"
                            || /(?:requested|booked) .* (?:on your ride|ride)/i.test(n.message));
                    return `
                    <div class="card-quiet notification-item">
                        <div>
                            <p class="notification-message">${escapeHTML(n.message)}</p>
                            <span class="field-hint">${new Date(n.createdAt).toLocaleString("en-IN")}</span>
                            ${isBookingRequest ? `<div class="booking-request-actions notification-actions">
                                <button class="btn btn-primary notification-booking-action" data-status="accepted" data-booking-id="${escapeHTML(request.bookingId)}">Accept</button>
                                <button class="btn btn-ghost notification-booking-action" data-status="declined" data-booking-id="${escapeHTML(request.bookingId)}">Decline</button>
                                <button class="btn btn-danger notification-booking-delete" data-booking-id="${escapeHTML(request.bookingId)}">Delete</button>
                            </div>` : ""}
                        </div>
                        <button type="button" class="notification-delete" data-notification-id="${escapeHTML(n.id)}" aria-label="Delete notification" title="Delete notification">
                            <i class="fa-solid fa-trash" aria-hidden="true"></i>
                        </button>
                    </div>`;
                }).join("")
                : `<p class="field-hint">No notifications yet.</p>`;

            list.querySelectorAll(".notification-delete").forEach(button => {
                button.addEventListener("click", async () => {
                    button.disabled = true;
                    const result = await deleteNotification(button.dataset.notificationId);
                    if (!result.success) {
                        button.disabled = false;
                        showToast(result.message, "error");
                        return;
                    }
                    showToast("Notification deleted.", "success");
                    await render();
                });
            });

            list.querySelectorAll(".notification-booking-action").forEach(button => {
                button.addEventListener("click", async () => {
                    button.disabled = true;
                    const result = await updateBookingStatus(button.dataset.bookingId, button.dataset.status);
                    if (!result.success) {
                        showToast(result.message, "error");
                        button.disabled = false;
                        return;
                    }
                    showToast(`Booking ${button.dataset.status}.`, "success");
                    await render();
                });
            });

            list.querySelectorAll(".notification-booking-delete").forEach(button => {
                button.addEventListener("click", async () => {
                    if (!window.confirm("Delete this booking request?")) return;
                    button.disabled = true;
                    const result = await deleteBookingRequest(button.dataset.bookingId);
                    if (!result.success) {
                        showToast(result.message, "error");
                        button.disabled = false;
                        return;
                    }
                    showToast("Booking request deleted.", "success");
                    await render();
                });
            });
        }
    }

    render();

    document.getElementById("notifBtn")?.addEventListener("click", () => {
        const panel = document.getElementById("notificationPanel");
        panel?.classList.toggle("open");
        if (panel?.classList.contains("open")) {
            markNotificationsRead(user.userId).then(render);
        }
    });

    if (isFirebaseEnabled() && firebase.firestore) {
        firebase.firestore().collection("notifications")
            .where("userId", "==", user.userId)
            .onSnapshot(() => render());
    }

    // Same-tab actions (booking, etc.) call render again directly;
    // this catches changes made in *other* tabs of the same browser.
    window.addEventListener("storage", (e) => {
        if (e.key === DB_KEYS.NOTIFICATIONS) render();
    });
}

/* =========================================================
   PUBLISH RIDE (offer-ride.html)
========================================================= */

function initPublishRideForm() {
    const form = document.getElementById("rideForm");
    if (!form) return;

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        await firebaseAuthReady;

        const from = document.getElementById("rideFrom")?.value.trim();
        const to = document.getElementById("rideTo")?.value.trim();
        const date = document.getElementById("rideDate")?.value;
        const time = document.getElementById("rideTime")?.value;
        const seats = Number(document.getElementById("rideSeats")?.value);
        const price = Number(document.getElementById("ridePrice")?.value);
        const vehicle = document.getElementById("vehicle")?.value.trim();

        if (!from || !to || !date || !time || !seats || !vehicle) {
            showToast("Please fill all ride details correctly.", "error");
            return;
        }

        const result = await publishRide({ from, to, date, time, seats, price, vehicle });
        if (!result.success) {
            showToast(result.message, "error");
            return;
        }

        showToast("Ride published successfully!", "success");
        setTimeout(() => window.location.href = "find-ride.html", 800);
    });
}

/* =========================================================
   RIDE LIST + SEARCH (find-ride.html)
========================================================= */

async function renderRideList(rides) {
    const container = document.getElementById("publishedRide");
    if (!container) return;
    const currentUser = getCurrentUser();
    let passengerBookings = [];
    try {
        passengerBookings = await getPassengerBookingsAsync();
    } catch (error) {
        console.warn("RideMitra: booking status is unavailable while rendering rides.", error);
    }

    if (!rides.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-road"></i>
                <h3>No rides match yet</h3>
                <p>Try different locations or dates, or be the first to publish one.</p>
                <a href="offer-ride.html" class="btn btn-primary">Publish a ride</a>
            </div>`;
        return;
    }

    container.innerHTML = rides.map(ride => {
        const isOwn = currentUser && ride.driverId === currentUser.userId;
        const full = ride.availableSeats <= 0;
        const booking = passengerBookings.find(item => item.rideId === ride.rideId
            && ["pending", "accepted"].includes(item.status || "pending"));
        return `
        <article class="ride-card" data-ride-id="${ride.rideId}">
            <div>
                <div class="route-line">
                    <div class="route-point"><small>FROM</small><strong>${escapeHTML(ride.from)}</strong></div>
                    <i class="fa-solid fa-arrow-right route-arrow"></i>
                    <div class="route-point"><small>TO</small><strong>${escapeHTML(ride.to)}</strong></div>
                </div>
                <div class="ride-meta">
                    <span><i class="fa-regular fa-calendar"></i> ${formatDate(ride.date)}</span>
                    <span><i class="fa-regular fa-clock"></i> ${escapeHTML(ride.time || "")}</span>
                    <span><i class="fa-solid fa-car"></i> ${escapeHTML(ride.vehicle)}</span>
                    <span><i class="fa-regular fa-user"></i> ${escapeHTML(ride.driverName)}</span>
                </div>
            </div>
            <div class="ride-side">
                <div class="ride-price">${formatCurrency(ride.price)}<span> / seat</span></div>
                <span class="pill ${full ? "" : "pill-good"}">${full ? "Fully booked" : ride.availableSeats + " seats left"}</span>
                ${isOwn
                    ? `<span class="pill">Your ride</span>`
                    : booking
                    ? `<button class="btn btn-danger cancel-booking-btn" data-ride-id="${ride.rideId}">Cancel booking</button>`
                    : full
                    ? `<button class="btn btn-primary book-btn" disabled data-ride-id="${ride.rideId}">Fully booked</button>`
                    : `<div class="book-controls">
                        <label for="seats-${escapeHTML(ride.rideId)}">Seats</label>
                        <select id="seats-${escapeHTML(ride.rideId)}" class="seat-count" data-ride-id="${escapeHTML(ride.rideId)}" aria-label="Number of seats to book">
                            ${Array.from({ length: ride.availableSeats }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join("")}
                        </select>
                        <button class="btn btn-primary book-btn" data-ride-id="${escapeHTML(ride.rideId)}">Book ride</button>
                    </div>`
                }
            </div>
        </article>`;
    }).join("");

    container.querySelectorAll(".book-btn").forEach(btn => {
        btn.addEventListener("click", () => handleBookClick(btn.dataset.rideId));
    });
    container.querySelectorAll(".cancel-booking-btn").forEach(btn => {
        btn.addEventListener("click", () => handleCancelBookingClick(btn.dataset.rideId));
    });
}

async function handleBookClick(rideId) {
    const user = getCurrentUser();
    if (!user) {
        showToast("Please login to book a ride.", "warning");
        setTimeout(() => window.location.href = "login.html", 700);
        return;
    }

    const ride = await findRideAsync(rideId);
    if (!ride) return;

    const seatsInput = document.querySelector(`.seat-count[data-ride-id="${CSS.escape(rideId)}"]`);
    const seatsBooked = Number(seatsInput?.value || 1);
    if (!Number.isInteger(seatsBooked) || seatsBooked < 1 || seatsBooked > ride.availableSeats) {
        showToast("Please choose a valid number of seats.", "error");
        return;
    }

    const confirmed = window.confirm(
        `Book ${seatsBooked} seat${seatsBooked > 1 ? "s" : ""} from ${ride.from} to ${ride.to} for ${formatCurrency(ride.price * seatsBooked)}?`
    );
    if (!confirmed) return;

    const result = await bookRide(rideId, seatsBooked);
    if (!result.success) {
        showToast(result.message, "error");
        return;
    }

    showToast("Ride booked! The driver has been notified.", "success");
    await renderRideList(await getRidesForPassengerAsync());
}

async function handleCancelBookingClick(rideId) {
    const confirmed = window.confirm("Cancel your booking for this ride?");
    if (!confirmed) return;
    const result = await cancelBooking(rideId);
    if (!result.success) {
        showToast(result.message, "error");
        return;
    }
    showToast("Booking cancelled. The seat is available again.", "success");
    await renderRideList(await getRidesForPassengerAsync());
}

async function initRideListPage() {
    const container = document.getElementById("publishedRide");
    if (!container) return;
    await firebaseAuthReady;
    try {
        await renderRideList(await getAvailableRidesAsync());
    } catch (error) {
        const message = error?.code === "permission-denied"
            ? (firebase.auth?.currentUser
                ? "Ride access denied. Publish the latest Firestore rules, then refresh."
                : "Please log in again to view published rides.")
            : "Unable to load published rides.";
        showToast(message, "error");
        return;
    }

    if (isFirebaseEnabled() && firebase.firestore) {
        firebase.firestore().collection("rides").onSnapshot(snapshot => {
            getRidesForPassengerAsync().then(rides => renderRideList(rides));
        }, error => {
            showToast(error?.code === "permission-denied"
                ? "Ride access denied. Publish the latest Firestore rules, then refresh."
                : "Live ride updates are unavailable.", "error");
        });
    }
}

function initRideSearch() {
    const searchBtn = document.getElementById("searchButton");
    if (!searchBtn) return;

    searchBtn.addEventListener("click", async () => {
        const from = document.getElementById("fromLocation")?.value || "";
        const to = document.getElementById("toLocation")?.value || "";
        const date = document.getElementById("travelDate")?.value || "";
        try {
            const results = await searchRides({ from, to, date });
            await renderRideList(results);
            if (!results.length) showToast("No matching rides found.", "info");
        } catch (error) {
            showToast(error?.code === "permission-denied"
                ? "Please log in again to search rides."
                : "Unable to search rides.", "error");
        }
    });
}

/* =========================================================
   DASHBOARD STATS
========================================================= */

async function initDashboardStats() {
    const user = getCurrentUser();
    if (!user) return;

    const rides = await getAllRidesAsync();
    const bookings = await getAllBookingsAsync();

    const myPublished = rides.filter(r => r.driverId === user.userId);
    const myBookings = bookings.filter(b => b.passengerId === user.userId);

    document.querySelectorAll("[data-stat='published-rides']").forEach(el => el.textContent = myPublished.length);
    document.querySelectorAll("[data-stat='booked-rides']").forEach(el => el.textContent = myBookings.length);

    const earnings = myPublished.reduce((total, ride) => {
        const bookedSeats = ride.seats - ride.availableSeats;
        return total + bookedSeats * ride.price;
    }, 0);
    document.querySelectorAll("[data-stat='earnings']").forEach(el => el.textContent = formatCurrency(earnings));

    const recentContainer = document.getElementById("myRecentRides");
    if (recentContainer) {
        const recent = myPublished.slice(0, 5);
        recentContainer.innerHTML = recent.length
            ? recent.map(ride => `
                <div class="ride-card">
                    <div>
                        <div class="route-line">
                            <div class="route-point"><small>FROM</small><strong>${escapeHTML(ride.from)}</strong></div>
                            <i class="fa-solid fa-arrow-right route-arrow"></i>
                            <div class="route-point"><small>TO</small><strong>${escapeHTML(ride.to)}</strong></div>
                        </div>
                        <div class="ride-meta">
                            <span><i class="fa-regular fa-calendar"></i> ${formatDate(ride.date)}</span>
                            <span><i class="fa-solid fa-chair"></i> ${ride.availableSeats}/${ride.seats} seats left</span>
                        </div>
                    </div>
                    <div class="ride-side">
                        <span class="pill ${ride.status === "available" ? "pill-good" : ""}">${ride.status}</span>
                        <button class="btn btn-danger delete-ride-btn" data-ride-id="${escapeHTML(ride.rideId)}">Delete</button>
                    </div>
                </div>`).join("")
            : `<div class="empty-state"><i class="fa-solid fa-car"></i><h3>No rides published yet</h3><p>Offer a ride to see it here.</p><a href="offer-ride.html" class="btn btn-primary">Publish a ride</a></div>`;

        recentContainer.querySelectorAll(".delete-ride-btn").forEach(button => {
            button.addEventListener("click", async () => {
                if (!window.confirm("Delete this published ride? This cannot be undone.")) return;
                button.disabled = true;
                const result = await deleteRide(button.dataset.rideId);
                if (!result.success) {
                    showToast(result.message, "error");
                    button.disabled = false;
                    return;
                }
                showToast("Ride deleted successfully.", "success");
                await initDashboardStats();
            });
        });
    }
}

async function initBookingRequests() {
    const container = document.getElementById("bookingRequests");
    if (!container) return;

    async function render() {
        const requests = await getBookingRequestsAsync();
        const pending = requests.filter(request => !request.status || request.status === "pending");
        const count = document.getElementById("bookingRequestCount");
        if (count) count.textContent = `${pending.length} pending`;
        container.innerHTML = pending.length
            ? pending.slice(0, 10).map(request => `
                <article class="card booking-request-card">
                    <div>
                        <strong>${escapeHTML(request.passengerName || "Rider")}</strong>
                        <p class="field-hint">${request.seatsBooked} seat${request.seatsBooked > 1 ? "s" : ""} requested</p>
                        <span class="pill">pending</span>
                    </div>
                    ${(!request.status || request.status === "pending") ? `<div class="booking-request-actions">
                        <button class="btn btn-primary booking-action" data-status="accepted" data-booking-id="${request.bookingId}">Accept</button>
                        <button class="btn btn-ghost booking-action" data-status="declined" data-booking-id="${request.bookingId}">Decline</button>
                        <button class="btn btn-danger booking-delete" data-booking-id="${request.bookingId}">Delete</button>
                    </div>` : ""}
                </article>`).join("")
            : `<div class="empty-state"><i class="fa-solid fa-inbox"></i><h3>No booking requests</h3><p>New passenger requests will appear here.</p></div>`;

        container.querySelectorAll(".booking-action").forEach(button => {
            button.addEventListener("click", async () => {
                button.disabled = true;
                const result = await updateBookingStatus(button.dataset.bookingId, button.dataset.status);
                if (!result.success) showToast(result.message, "error");
                else showToast(`Booking ${button.dataset.status}.`, "success");
                await render();
            });
        });

        container.querySelectorAll(".booking-delete").forEach(button => {
            button.addEventListener("click", async () => {
                if (!window.confirm("Delete this booking request?")) return;
                button.disabled = true;
                const result = await deleteBookingRequest(button.dataset.bookingId);
                if (!result.success) {
                    showToast(result.message, "error");
                    button.disabled = false;
                    return;
                }
                showToast("Booking request deleted.", "success");
                await render();
            });
        });
    }

    await render();
    if (isFirebaseEnabled() && firebase.firestore) {
        firebase.firestore().collection("bookings")
            .where("driverId", "==", getCurrentUser().userId)
            .onSnapshot(() => render(), () => showToast("Unable to refresh booking requests.", "error"));
    }
}

/* =========================================================
   ACCOUNT PAGE
========================================================= */

async function renderAccountOverview(user) {
    const list = document.getElementById("accountOverviewList");
    if (!list) return;

    const settings = getSettings();
    const allRides = await getAllRidesAsync();
    const allBookings = await getAllBookingsAsync();
    const rides = allRides.filter(r => r.driverId === user.userId || r.rideId && allBookings.some(b => b.rideId === r.rideId && b.passengerId === user.userId));
    const verificationState = /^\d{10}$/.test(user.phone || "") ? { label: "Verified", className: "active" } : { label: "Pending", className: "pending" };
    const paymentState = settings.paymentMethod ? { label: settings.paymentMethod, className: "active" } : { label: "Not set", className: "pending" };
    const safetyState = /^\d{10}$/.test(user.phone || "") ? { label: "Ready", className: "active" } : { label: "Setup", className: "pending" };
    const alertsState = settings.pushNotifications || settings.emailAlerts || settings.rideUpdates ? { label: "On", className: "active" } : { label: "Off", className: "pending" };
    const profileState = settings.privateProfile ? { label: "Private", className: "pending" } : { label: "Public", className: "active" };
    const savedTrips = rides.length;

    const rows = [
        { title: "Verification status", note: "Phone and identity state for this account", value: verificationState },
        { title: "Payment method", note: "Saved payment preference in app settings", value: paymentState },
        { title: "Saved trips", note: `${savedTrips} trip${savedTrips === 1 ? "" : "s"} tracked in this browser`, value: { label: savedTrips ? "Linked" : "None", className: savedTrips ? "active" : "pending" } },
        { title: "Safety center", note: "Emergency and trusted-contact setup", value: safetyState },
        { title: "Ride alerts", note: "Notifications currently enabled", value: alertsState },
        { title: "Profile visibility", note: "Who can see your profile", value: profileState }
    ];

    list.innerHTML = rows.map(item => `
        <div class="option-item">
            <div>
                <strong>${escapeHTML(item.title)}</strong>
                <small>${escapeHTML(item.note)}</small>
            </div>
            <span class="status-tag ${item.value.className}">${escapeHTML(item.value.label)}</span>
        </div>
    `).join("");
}

function initAccountPage() {
    const form = document.getElementById("accountForm");
    if (!form) return;
    const user = getCurrentUser();
    if (!user) return;

    const nameInput = document.getElementById("accountName");
    const emailInput = document.getElementById("accountEmail");
    const phoneInput = document.getElementById("accountPhone");

    nameInput.value = user.name;
    emailInput.value = user.email;
    phoneInput.value = user.phone;

    renderAccountOverview(user);

    phoneInput?.addEventListener("input", function () {
        this.value = this.value.replace(/\D/g, "").slice(0, 10);
    });

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const name = nameInput.value.trim();
        const phone = phoneInput.value.trim();

        if (name.length < 2) return showToast("Please enter a valid name.", "error");
        if (!/^\d{10}$/.test(phone)) return showToast("Enter a valid 10-digit phone number.", "error");

        const users = getUsers();
        const target = users.find(u => u.userId === user.userId);
        if (!target) return showToast("User not found.", "error");

        target.name = name;
        target.phone = phone;
        writeList(DB_KEYS.USERS, users);

        showToast("Profile updated.", "success");
        initUserChip();
        renderAccountOverview(target);
    });
}

function getSettings() {
    try {
        const raw = localStorage.getItem("rm_user_settings");
        return raw ? JSON.parse(raw) : {
            pushNotifications: true,
            emailAlerts: true,
            rideUpdates: true,
            privateProfile: false,
            locationAccess: true,
            activityStatus: true,
            language: "English",
            distanceUnit: "km",
            paymentMethod: "UPI",
            currency: "INR"
        };
    } catch (error) {
        return {
            pushNotifications: true,
            emailAlerts: true,
            rideUpdates: true,
            privateProfile: false,
            locationAccess: true,
            activityStatus: true,
            language: "English",
            distanceUnit: "km",
            paymentMethod: "UPI",
            currency: "INR"
        };
    }
}

function setSettings(nextSettings) {
    localStorage.setItem("rm_user_settings", JSON.stringify(nextSettings));
}

function initSettingsPage() {
    const form = document.getElementById("settingsForm");
    if (!form) return;

    const user = getCurrentUser();
    if (!user) return;

    const nameInput = document.getElementById("settingsName");
    const emailInput = document.getElementById("settingsEmail");
    const phoneInput = document.getElementById("settingsPhone");
    const passwordInput = document.getElementById("settingsPassword");
    const languageInput = document.getElementById("settingsLanguage");
    const unitInput = document.getElementById("settingsUnit");
    const paymentMethodInput = document.getElementById("settingsPaymentMethod");
    const currencyInput = document.getElementById("settingsCurrency");

    const settings = getSettings();

    nameInput.value = user.name;
    emailInput.value = user.email;
    phoneInput.value = user.phone;
    languageInput.value = settings.language || "English";
    unitInput.value = settings.distanceUnit || "km";
    paymentMethodInput.value = settings.paymentMethod || "UPI";
    currencyInput.value = settings.currency || "INR";

    document.getElementById("notifyPush").checked = !!settings.pushNotifications;
    document.getElementById("notifyEmail").checked = !!settings.emailAlerts;
    document.getElementById("notifyRide").checked = !!settings.rideUpdates;
    document.getElementById("privacyProfile").checked = !!settings.privateProfile;
    document.getElementById("privacyLocation").checked = !!settings.locationAccess;
    document.getElementById("privacyActivity").checked = !!settings.activityStatus;

    phoneInput?.addEventListener("input", function () {
        this.value = this.value.replace(/\D/g, "").slice(0, 10);
    });

    form.addEventListener("submit", (event) => {
        event.preventDefault();

        const name = nameInput.value.trim();
        const phone = phoneInput.value.trim();
        const newPassword = passwordInput.value.trim();

        if (name.length < 2) return showToast("Please enter a valid name.", "error");
        if (!/^\d{10}$/.test(phone)) return showToast("Enter a valid 10-digit phone number.", "error");
        if (newPassword && newPassword.length < 6) return showToast("New password must be at least 6 characters.", "error");

        const users = getUsers();
        const target = users.find(u => u.userId === user.userId);
        if (!target) return showToast("User not found.", "error");

        target.name = name;
        target.phone = phone;
        if (newPassword) target.password = obscure(newPassword);
        writeList(DB_KEYS.USERS, users);

        const nextSettings = {
            pushNotifications: document.getElementById("notifyPush").checked,
            emailAlerts: document.getElementById("notifyEmail").checked,
            rideUpdates: document.getElementById("notifyRide").checked,
            privateProfile: document.getElementById("privacyProfile").checked,
            locationAccess: document.getElementById("privacyLocation").checked,
            activityStatus: document.getElementById("privacyActivity").checked,
            language: languageInput.value,
            distanceUnit: unitInput.value,
            paymentMethod: paymentMethodInput.value,
            currency: currencyInput.value
        };
        setSettings(nextSettings);

        showToast("Settings saved.", "success");
        initUserChip();
        renderAccountOverview(target);
    });
}

/* =========================================================
   BOOT
========================================================= */

document.addEventListener("DOMContentLoaded", async function () {
    ensureFirebase();
    await firebaseAuthReady;

    protectPage();
    redirectAuthenticatedUser();

    initSignupForm();
    initLoginForm();

    initUserChip();
    initMobileSidebar();
    initActiveNav();
    initLandingNav();
    initNotifications();

    initPublishRideForm();
    initRideListPage();
    initRideSearch();

    initDashboardStats();
    initBookingRequests();
    initAccountPage();
    initSettingsPage();
});
