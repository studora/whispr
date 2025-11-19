import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, setDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

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
const headerStatus = document.getElementById('header-status');
const emojiToggle = document.getElementById('emoji-toggle');
const emojiPicker = document.getElementById('emoji-picker');
const backBtn = document.getElementById('back-btn');

// State
let currentUser = null;
let selectedUser = null;
let messagesUnsubscribe = null;
let statusUnsubscribe = null;
let statusInterval = null; 
let isPageVisible = true;
let lastMessageDate = null; 

// --- MOBILE NAVIGATION LOGIC (CRITICAL) ---
backBtn.addEventListener('click', () => {
    // 1. Remove class to switch view back to sidebar
    document.body.classList.remove('mobile-chat-active');
    
    // 2. Optional: Hide chat interface slightly delayed for smoother feel, or immediately
    chatInterface.classList.add('hidden');
    
    // 3. Stop listeners
    if (messagesUnsubscribe) messagesUnsubscribe();
    if (statusUnsubscribe) statusUnsubscribe();
    if (statusInterval) clearInterval(statusInterval);
    selectedUser = null;
});

// --- EMOJI ---
emojiToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle('hidden');
});

document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        msgInput.value += btn.textContent;
        msgInput.focus();
    });
});

document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && !emojiToggle.contains(e.target)) {
        emojiPicker.classList.add('hidden');
    }
});

// --- HEARTBEAT ---
function startHeartbeat(user) {
    updateMyStatus(user.uid);
    setInterval(() => { updateMyStatus(user.uid); }, 10000); 
}

async function updateMyStatus(uid) {
    try { await setDoc(doc(db, "users", uid), { lastActive: serverTimestamp() }, { merge: true }); } catch (e) {}
}

// --- VISIBILITY ---
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

// --- AUTH ---
loginBtn.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
        requestNotifyPermission();
    } catch (error) { console.error(error); }
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

        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            displayName: user.displayName,
            photoURL: user.photoURL,
            email: user.email
        }, { merge: true });

        startHeartbeat(user);
        loadUsers();
    } else {
        currentUser = null;
        loginScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
    }
});

// --- USERS ---
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

// --- CHAT SELECTION (TRIGGER MOBILE VIEW) ---
function selectChat(user) {
    selectedUser = user;
    
    // 1. Show Interface
    emptyState.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    
    // 2. CRITICAL: ADD CLASS TO BODY TO TRIGGER CSS VIEW SWITCH
    document.body.classList.add('mobile-chat-active');

    document.getElementById('header-avatar').src = user.photoURL;
    document.getElementById('header-name').textContent = user.displayName;
    
    monitorUserStatus(user.uid);
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    loadMessages(chatId);
}

// --- STATUS MONITOR ---
function monitorUserStatus(uid) {
    if (statusUnsubscribe) statusUnsubscribe(); 
    if (statusInterval) clearInterval(statusInterval);

    const userRef = doc(db, "users", uid);
    let lastActiveTime = 0; 

    statusUnsubscribe = onSnapshot(userRef, (doc) => {
        const data = doc.data();
        if (data && data.lastActive) { lastActiveTime = data.lastActive.toDate().getTime(); }
        updateUI(); 
    });

    statusInterval = setInterval(() => { updateUI(); }, 5000);

    function updateUI() {
        if (lastActiveTime === 0) { headerStatus.innerHTML = "Offline"; return; }
        const diff = Date.now() - lastActiveTime;
        if (diff < 35000) {
            headerStatus.innerHTML = `<span class="status-dot" style="background:#ff5e9a"></span> Online`;
            headerStatus.style.color = "#ffebf3";
        } else {
            headerStatus.innerHTML = `<span class="status-dot" style="background:#666"></span> Offline`;
            headerStatus.style.color = "#666";
        }
    }
}

// --- MESSAGES ---
function loadMessages(chatId) {
    if (messagesUnsubscribe) messagesUnsubscribe();
    msgContainer.innerHTML = ''; 
    lastMessageDate = null;

    const q = query(
        collection(db, "chats", chatId, "messages"), 
        orderBy("createdAt", "asc")
    );

    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        msgContainer.innerHTML = ''; 
        lastMessageDate = null;

        snapshot.forEach((doc) => {
            renderMessage(doc.data(), doc.id, chatId);
        });

        const changes = snapshot.docChanges();
        if (changes.length > 0) {
             const lastChange = changes[changes.length - 1];
             if (lastChange.type === 'added') {
                 const msg = lastChange.doc.data();
                 if (!lastChange.doc.metadata.hasPendingWrites && msg.senderId !== currentUser.uid) {
                     notifyUser(msg.text);
                 }
             }
        }
        
        scrollToBottom();
    });
}

function getFormattedDate(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderMessage(msg, msgId, chatId) {
    if (msg.createdAt) {
        const dateObj = msg.createdAt.toDate();
        const dateStr = dateObj.toDateString();
        if (dateStr !== lastMessageDate) {
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.innerHTML = `<span>${getFormattedDate(dateObj)}</span>`;
            msgContainer.appendChild(divider);
            lastMessageDate = dateStr;
        }
    }

    const div = document.createElement('div');
    const isMe = msg.senderId === currentUser.uid;
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    
    let time = "";
    if (msg.createdAt) {
        const date = msg.createdAt.toDate();
        time = date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');
    }

    let reactionHtml = '';
    if (msg.reaction) {
        reactionHtml = `<span class="reaction-badge">❤️</span>`;
    }

    div.innerHTML = `${msg.text}<span class="timestamp">${time}</span>${reactionHtml}`;
    div.addEventListener('dblclick', () => toggleHeart(chatId, msgId, msg.reaction));
    msgContainer.appendChild(div);
}

async function toggleHeart(chatId, msgId, currentReaction) {
    const msgRef = doc(db, "chats", chatId, "messages", msgId);
    const newStatus = currentReaction ? null : true;
    try { await updateDoc(msgRef, { reaction: newStatus }); } catch (e) {}
}

function notifyUser(text) {
    if (!isPageVisible) {
        document.title = `(1) ❤️ Message`;
        try { notifySound.currentTime = 0; notifySound.play().catch(()=>{}); } catch(e){}
        if (Notification.permission === "granted") {
            const n = new Notification(`New Message`, { body: text, icon: selectedUser.photoURL });
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
    emojiPicker.classList.add('hidden'); 

    try {
        await addDoc(collection(db, "chats", chatId, "messages"), {
            text: text,
            senderId: currentUser.uid,
            createdAt: serverTimestamp(),
            reaction: null
        });
        scrollToBottom();
    } catch (e) { console.error(e); }
});

function scrollToBottom() {
    msgContainer.scrollTop = msgContainer.scrollHeight;
}
