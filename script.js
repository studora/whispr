import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, setDoc, doc, updateDoc, where, getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

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
const typingIndicator = document.getElementById('typing-indicator'); // NEW
const emojiToggle = document.getElementById('emoji-toggle');
const emojiPicker = document.getElementById('emoji-picker');
const backBtn = document.getElementById('back-btn');
const replyPreview = document.getElementById('reply-preview'); // NEW
const replyText = document.getElementById('reply-text'); // NEW
const closeReplyBtn = document.getElementById('close-reply'); // NEW
const reactionMenu = document.getElementById('reaction-menu'); // NEW

// State
let currentUser = null;
let selectedUser = null;
let messagesUnsubscribe = null;
let statusUnsubscribe = null;
let statusInterval = null; 
let isPageVisible = true;
let lastMessageDate = null; 
let replyTarget = null; // Stores message ID being replied to
let typingTimeout = null;

// --- MOBILE NAVIGATION ---
backBtn.addEventListener('click', () => {
    document.body.classList.remove('mobile-chat-active');
    setTimeout(() => chatInterface.classList.add('hidden'), 300);
    if (messagesUnsubscribe) messagesUnsubscribe();
    if (statusUnsubscribe) statusUnsubscribe();
    if (statusInterval) clearInterval(statusInterval);
    selectedUser = null;
});

// --- EMOJI & REACTION MENU ---
emojiToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle('hidden');
});

document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        msgInput.value += btn.textContent;
        msgInput.focus();
        handleTyping(); // Trigger typing
    });
});

// Reaction Menu Logic
document.querySelectorAll('#reaction-menu span').forEach(span => {
    span.addEventListener('click', async () => {
        const r = span.getAttribute('data-r');
        const msgId = reactionMenu.getAttribute('data-msg-id');
        const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
        
        await toggleHeart(chatId, msgId, r); // Using r as the specific emoji
        reactionMenu.classList.add('hidden');
    });
});

document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && !emojiToggle.contains(e.target)) emojiPicker.classList.add('hidden');
    if (!reactionMenu.contains(e.target)) reactionMenu.classList.add('hidden');
});

// --- TYPING INDICATOR LOGIC ---
msgInput.addEventListener('input', handleTyping);

async function handleTyping() {
    if (!selectedUser) return;
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    
    // Update Firestore that I am typing
    try {
        // We update a dedicated collection or field. Here we use 'users' status for simplicity or chats doc
        const chatRef = doc(db, "chats", chatId);
        await setDoc(chatRef, { typing: { [currentUser.uid]: true } }, { merge: true });
        
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(async () => {
            await setDoc(chatRef, { typing: { [currentUser.uid]: false } }, { merge: true });
        }, 2000); // Stop typing after 2 seconds of inactivity
    } catch(e) {}
}

function listenForTyping(chatId) {
    const chatRef = doc(db, "chats", chatId);
    onSnapshot(chatRef, (doc) => {
        if(doc.exists()) {
            const data = doc.data();
            // Check if the OTHER user is typing
            if (data.typing && data.typing[selectedUser.uid]) {
                typingIndicator.classList.remove('hidden');
                headerStatus.classList.add('hidden');
            } else {
                typingIndicator.classList.add('hidden');
                headerStatus.classList.remove('hidden');
            }
        }
    });
}

// --- REPLY SYSTEM ---
function startReply(id, text, senderName) {
    replyTarget = { id, text, senderName };
    replyPreview.classList.remove('hidden');
    replyText.textContent = text;
    msgInput.focus();
}

closeReplyBtn.addEventListener('click', () => {
    replyTarget = null;
    replyPreview.classList.add('hidden');
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
        if (selectedUser) markCurrentChatSeen();
    } else { isPageVisible = false; }
});

function requestNotifyPermission() {
    if ("Notification" in window && Notification.permission !== "granted") Notification.requestPermission();
}

// --- AUTH ---
loginBtn.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); requestNotifyPermission(); } catch (error) { console.error(error); }
});
logoutBtn.addEventListener('click', () => { signOut(auth); location.reload(); });

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        loginScreen.classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('my-avatar').src = user.photoURL;
        document.getElementById('my-name').textContent = user.displayName.split(' ')[0];
        await setDoc(doc(db, "users", user.uid), { uid: user.uid, displayName: user.displayName, photoURL: user.photoURL, email: user.email }, { merge: true });
        startHeartbeat(user);
        loadUsers();
    } else {
        currentUser = null;
        loginScreen.classList.remove('hidden');
        document.getElementById('app').classList.add('hidden');
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
                    <div class="user-info"><h4>${user.displayName}</h4><p>Tap to chat</p></div>
                `;
                div.addEventListener('click', () => selectChat(user));
                userListEl.appendChild(div);
            }
        });
    });
}

// --- CHAT SELECT ---
function selectChat(user) {
    selectedUser = user;
    emptyState.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    document.body.classList.add('mobile-chat-active');
    document.getElementById('header-avatar').src = user.photoURL;
    document.getElementById('header-name').textContent = user.displayName;
    
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    monitorUserStatus(user.uid);
    listenForTyping(chatId); // New: Listen for typing
    loadMessages(chatId);
}

// --- STATUS ---
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

    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"));

    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        msgContainer.innerHTML = ''; 
        lastMessageDate = null;
        snapshot.forEach((docSnap) => {
            const msg = docSnap.data();
            renderMessage(msg, docSnap.id, chatId);
            if (msg.senderId !== currentUser.uid && msg.status === 'sent' && isPageVisible) {
                updateDoc(docSnap.ref, { status: 'seen' });
            }
        });
        const changes = snapshot.docChanges();
        if (changes.length > 0) {
             const lastChange = changes[changes.length - 1];
             if (lastChange.type === 'added') {
                 const msg = lastChange.doc.data();
                 if (!lastChange.doc.metadata.hasPendingWrites && msg.senderId !== currentUser.uid) notifyUser(msg.text);
             }
        }
        scrollToBottom();
    });
}

async function markCurrentChatSeen() {
    if (!currentUser || !selectedUser) return;
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    const q = query(collection(db, "chats", chatId, "messages"), where("senderId", "==", selectedUser.uid), where("status", "==", "sent"));
    const snapshot = await getDocs(q);
    snapshot.forEach((docSnap) => { updateDoc(docSnap.ref, { status: 'seen' }); });
}

function renderMessage(msg, msgId, chatId) {
    if (msg.createdAt) {
        const dateObj = msg.createdAt.toDate();
        const dateStr = dateObj.toDateString();
        if (dateStr !== lastMessageDate) {
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.innerHTML = `<span>${dateObj.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' })}</span>`;
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

    let tickHtml = '';
    if (isMe) {
        let tickClass = 'tick-sent'; let tickIcon = 'fa-check';
        if (msg.status === 'seen') { tickClass = 'tick-seen'; tickIcon = 'fa-check-double'; }
        tickHtml = `<i class="fas ${tickIcon} tick-icon ${tickClass}"></i>`;
    }

    let reactionHtml = msg.reaction ? `<span class="reaction-badge">${msg.reaction}</span>` : '';
    
    // Render Reply Block
    let replyHtml = '';
    if(msg.replyTo) {
        replyHtml = `<div class="reply-quote"><strong>${msg.replyTo.senderName}</strong>: ${msg.replyTo.text}</div>`;
    }

    // Action Buttons (Reply/React) - Mobile friendly touch area
    const actionsHtml = `
        <div class="msg-actions">
            <button class="action-btn reply-action"><i class="fas fa-reply"></i></button>
            <button class="action-btn react-action"><i class="far fa-smile"></i></button>
        </div>
    `;

    div.innerHTML = `
        ${replyHtml}
        ${msg.text}
        <span class="timestamp">${time} ${tickHtml}</span>
        ${reactionHtml}
        ${actionsHtml}
    `;
    
    // Reaction Menu Trigger
    div.querySelector('.react-action').addEventListener('click', (e) => {
        e.stopPropagation();
        reactionMenu.classList.remove('hidden');
        reactionMenu.style.top = (e.clientY - 50) + 'px';
        reactionMenu.style.left = e.clientX + 'px';
        reactionMenu.setAttribute('data-msg-id', msgId);
    });

    // Reply Trigger
    div.querySelector('.reply-action').addEventListener('click', (e) => {
        e.stopPropagation();
        startReply(msgId, msg.text, isMe ? "You" : selectedUser.displayName);
    });

    // Double tap heart (Classic)
    div.addEventListener('dblclick', () => toggleHeart(chatId, msgId, msg.reaction ? null : "❤️"));

    msgContainer.appendChild(div);
}

async function toggleHeart(chatId, msgId, emoji) {
    const msgRef = doc(db, "chats", chatId, "messages", msgId);
    try { await updateDoc(msgRef, { reaction: emoji }); } catch (e) {}
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
    
    // Prepare Reply Data
    let replyData = null;
    if (replyTarget) {
        replyData = replyTarget;
        replyTarget = null;
        replyPreview.classList.add('hidden');
    }

    try {
        await addDoc(collection(db, "chats", chatId, "messages"), {
            text: text,
            senderId: currentUser.uid,
            createdAt: serverTimestamp(),
            reaction: null,
            status: 'sent',
            replyTo: replyData // Save reply info
        });
        scrollToBottom();
    } catch (e) { console.error(e); }
});

function scrollToBottom() { msgContainer.scrollTop = msgContainer.scrollHeight; }
