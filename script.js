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

// Initialize Firebase
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

// State
let currentUser = null;
let selectedUser = null;
let messagesUnsubscribe = null;
let isPageVisible = true;

// --- NOTIFICATIONS & VISIBILITY ---

// 1. Check if user is looking at the tab
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'visible') {
        isPageVisible = true;
        document.title = "ClosedDoor"; // Reset title when you come back
    } else {
        isPageVisible = false;
    }
});

// 2. Request Permission
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
        // Ask for notification permission immediately after login
        requestNotifyPermission();
    } catch (error) {
        console.error("Login Error:", error);
        alert("Login failed. Turn off AdBlockers if using them.");
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

        // Save User to DB
        try {
            await setDoc(doc(db, "users", user.uid), {
                uid: user.uid,
                displayName: user.displayName,
                photoURL: user.photoURL,
                email: user.email,
                lastActive: serverTimestamp()
            }, { merge: true });
        } catch(e) { console.log("DB Error (Check AdBlocker)"); }

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
    
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    loadMessages(chatId);
}

function loadMessages(chatId) {
    if (messagesUnsubscribe) messagesUnsubscribe();
    msgContainer.innerHTML = ''; 

    const q = query(
        collection(db, "chats", chatId, "messages"), 
        orderBy("createdAt", "asc")
    );

    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        // snapshot.docChanges() gives us specifically what changed (added/modified)
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const msg = change.doc.data();
                renderMessage(msg);
                
                // NOTIFICATION TRIGGER
                // If it's a new message (not local write) AND not from me
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

// --- NOTIFICATION SYSTEM ---
function notifyUser(text) {
    // Only notify if page is NOT visible (user is in another tab or minimized)
    if (!isPageVisible) {
        
        // 1. Flash Tab Title
        document.title = `(1) New Message | ClosedDoor`;

        // 2. Play Sound (If allowed)
        try {
            notifySound.currentTime = 0;
            notifySound.play().catch(() => {}); // Catch error if user hasn't interacted
        } catch (e) {}

        // 3. System Notification (Pop-up)
        if (Notification.permission === "granted") {
            const notification = new Notification(`New Message from ${selectedUser.displayName}`, {
                body: text,
                icon: selectedUser.photoURL,
                silent: true // We play our own sound
            });
            
            // If user clicks notification, focus the window
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        }
    }
}

// Send Message
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
    } catch (e) {
        console.error("Error sending message:", e);
    }
});

function scrollToBottom() {
    msgContainer.scrollTop = msgContainer.scrollHeight;
}
