import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, setDoc, doc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// --- CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyDKTmbeR8vxWOimsera1WmC6a5mZc_Ewkc",
  authDomain: "closeddoor-58ac5.firebaseapp.com",
  projectId: "closeddoor-58ac5",
  storageBucket: "closeddoor-58ac5.firebasestorage.app",
  messagingSenderId: "330800003542",
  appId: "1:330800003542:web:2d02cf0d6eb01d5bdfcc77",
  measurementId: "G-B1DJWK271Y"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userListEl = document.getElementById('user-list');
const chatInterface = document.getElementById('chat-interface');
const emptyState = document.getElementById('empty-state');
const msgForm = document.getElementById('message-form');
const msgInput = document.getElementById('message-input');
const msgContainer = document.getElementById('messages-container');
const notifySound = document.getElementById('notify-sound');
const headerStatus = document.getElementById('header-status'); // New status element

// State
let currentUser = null;
let selectedUser = null;
let messagesUnsubscribe = null;
let statusUnsubscribe = null; // To listen to online status
let isPageVisible = true;

// --- 1. HEARTBEAT SYSTEM (Online Status) ---
// Updates "lastActive" every 2 minutes so others know I'm online
function startHeartbeat(user) {
    // Update immediately
    updateMyStatus(user.uid);
    
    // Then update every 2 minutes
    setInterval(() => {
        updateMyStatus(user.uid);
    }, 30000);
}

async function updateMyStatus(uid) {
    try {
        await setDoc(doc(db, "users", uid), {
            lastActive: serverTimestamp(),
            // We merge so we don't overwrite name/photo
        }, { merge: true });
    } catch (e) { console.log("Heartbeat skipped"); }
}

// --- 2. VISIBILITY & NOTIFICATIONS ---
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'visible') {
        isPageVisible = true;
        document.title = "ClosedDoor";
    } else {
        isPageVisible = false;
    }
});

function requestNotifyPermission() {
    if ("Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission();
    }
}

// --- AUTHENTICATION ---
loginBtn.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
        requestNotifyPermission();
    } catch (error) {
        console.error("Login Error:", error);
    }
});

logoutBtn.addEventListener('click', () => {
    signOut(auth);
    location.reload();
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        loginScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        
        document.getElementById('my-avatar').src = user.photoURL;
        document.getElementById('my-name').textContent = user.displayName.split(' ')[0];

        // Save basic info
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            displayName: user.displayName,
            photoURL: user.photoURL,
            email: user.email
        }, { merge: true });

        // Start the "I am Online" signal
        startHeartbeat(user);

        loadUsers();
    } else {
        currentUser = null;
        loginScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
    }
});

// --- LOAD USERS ---
function loadUsers() {
    const q = query(collection(db, "users"));
    onSnapshot(q, (snapshot) => {
        userListEl.innerHTML = '';
        snapshot.forEach((doc) => {
            const user = doc.data();
            if (user.uid !== currentUser.uid) {
                const div = document.createElement('div');
                div.className = 'user-item';
                div.innerHTML = `
                    <img src="${user.photoURL}" class="user-avatar">
                    <div class="user-info">
                        <h4>${user.displayName}</h4>
                        <p>Tap to chat</p>
                    </div>
                `;
                div.addEventListener('click', () => selectChat(user));
                userListEl.appendChild(div);
            }
        });
    });
}

// --- CHAT LOGIC ---
function selectChat(user) {
    selectedUser = user;
    
    emptyState.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    document.getElementById('header-avatar').src = user.photoURL;
    document.getElementById('header-name').textContent = user.displayName;
    
    // START LISTENING TO THEIR ONLINE STATUS
    monitorUserStatus(user.uid);

    // Load messages
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    loadMessages(chatId);
}

// --- REAL-TIME STATUS CHECK ---
function monitorUserStatus(uid) {
    if (statusUnsubscribe) statusUnsubscribe(); // Stop listening to previous user

    const userRef = doc(db, "users", uid);
    statusUnsubscribe = onSnapshot(userRef, (doc) => {
        const data = doc.data();
        if (data && data.lastActive) {
            const lastActiveTime = data.lastActive.toDate().getTime();
            const currentTime = Date.now();
            const diff = currentTime - lastActiveTime;

            // If active in last 3 minutes (180000 ms), consider Online
            if (diff < 180000) {
                headerStatus.innerHTML = `<span class="status-dot" style="background:#4cd137"></span> Online`;
                headerStatus.style.color = "#e0e0e0";
            } else {
                headerStatus.innerHTML = `<span class="status-dot" style="background:#666"></span> Offline`;
                headerStatus.style.color = "#666";
            }
        } else {
            headerStatus.innerHTML = "Offline";
        }
    });
}

function loadMessages(chatId) {
    if (messagesUnsubscribe) messagesUnsubscribe();
    msgContainer.innerHTML = ''; 

    const q = query(
        collection(db, "chats", chatId, "messages"), 
        orderBy("createdAt", "asc")
    );

    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const msg = change.doc.data();
                renderMessage(msg);
                
                // NOTIFICATION
                if (!change.doc.metadata.hasPendingWrites && msg.senderId !== currentUser.uid) {
                    notifyUser(msg.text);
                }
            }
        });
        scrollToBottom();
    });
}

function renderMessage(msg) {
    const div = document.createElement('div');
    const isMe = msg.senderId === currentUser.uid;
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    
    let time = "";
    if (msg.createdAt) {
        const date = msg.createdAt.toDate();
        time = date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');
    }

    div.innerHTML = `${msg.text}<span class="timestamp">${time}</span>`;
    msgContainer.appendChild(div);
}

function notifyUser(text) {
    if (!isPageVisible) {
        // 1. Navbar/Tab Flash
        document.title = `(1) Message | ClosedDoor`;

        // 2. Sound
        try { notifySound.currentTime = 0; notifySound.play().catch(()=>{}); } catch(e){}

        // 3. System Pop-up
        if (Notification.permission === "granted") {
            const n = new Notification(`New Message`, {
                body: text,
                icon: selectedUser.photoURL
            });
            n.onclick = () => window.focus();
        }
    }
}

msgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text || !selectedUser) return;

    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    msgInput.value = '';

    try {
        await addDoc(collection(db, "chats", chatId, "messages"), {
            text: text,
            senderId: currentUser.uid,
            createdAt: serverTimestamp()
        });
        scrollToBottom();
    } catch (e) { console.error(e); }
});

function scrollToBottom() {
    msgContainer.scrollTop = msgContainer.scrollHeight;
}
