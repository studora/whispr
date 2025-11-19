// --- IMPORTS FOR REALTIME DATABASE ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, serverTimestamp, query, orderByChild, update, onDisconnect } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

// --- CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyDKTmbeR8vxWOimsera1WmC6a5mZc_Ewkc",
  authDomain: "closeddoor-58ac5.firebaseapp.com",
  projectId: "closeddoor-58ac5",
  storageBucket: "closeddoor-58ac5.firebasestorage.app",
  messagingSenderId: "330800003542",
  appId: "1:330800003542:web:2d02cf0d6eb01d5bdfcc77",
  measurementId: "G-B1DJWK271Y",
  databaseURL: "https://closeddoor-58ac5-default-rtdb.firebaseio.com" // IMPORTANT: Ensure this is correct in your Firebase Console
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app); // Using Realtime Database

// --- DOM ELEMENTS ---
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

// Header
const headerAvatar = document.getElementById('header-avatar');
const headerName = document.getElementById('header-name');
const headerStatusContainer = document.getElementById('header-status-container');
const headerStatus = document.getElementById('header-status');
const typingIndicator = document.getElementById('typing-indicator');

// Tools
const emojiToggle = document.getElementById('emoji-toggle');
const emojiPicker = document.getElementById('emoji-picker');
const backBtn = document.getElementById('back-btn');
const replyPreview = document.getElementById('reply-preview');
const replyText = document.getElementById('reply-text');
const closeReplyBtn = document.getElementById('close-reply');
const reactionMenu = document.getElementById('reaction-menu');

// --- STATE ---
let currentUser = null;
let selectedUser = null;
let messagesRef = null;
let messagesListener = null;
let typingListener = null;
let presenceInterval = null;
let isPageVisible = true;
let replyTarget = null; 
let typingTimeout = null;
let lastDateRendered = null;

// --- UI HELPERS ---
backBtn.addEventListener('click', () => {
    document.body.classList.remove('mobile-chat-active');
    setTimeout(() => chatInterface.classList.add('hidden'), 300);
    // Detach listeners
    if (messagesRef) { /* listeners auto-detach when ref changes usually, but good to be safe in complex apps */ }
    selectedUser = null;
});

// Emoji & Menus
emojiToggle.addEventListener('click', (e) => { e.stopPropagation(); emojiPicker.classList.toggle('hidden'); });
document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => { msgInput.value += btn.textContent; msgInput.focus(); handleTyping(); });
});
document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && !emojiToggle.contains(e.target)) emojiPicker.classList.add('hidden');
    if (!reactionMenu.contains(e.target)) reactionMenu.classList.add('hidden');
});

// Reaction Logic
document.querySelectorAll('#reaction-menu span').forEach(span => {
    span.addEventListener('click', async () => {
        const r = span.getAttribute('data-r');
        const msgId = reactionMenu.getAttribute('data-msg-id');
        const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
        
        // Update reaction in RTDB
        const msgRef = ref(db, `chats/${chatId}/messages/${msgId}`);
        update(msgRef, { reaction: r });
        
        reactionMenu.classList.add('hidden');
    });
});

// --- TYPING INDICATOR (RTDB) ---
msgInput.addEventListener('input', handleTyping);

function handleTyping() {
    if (!selectedUser) return;
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    const myTypingRef = ref(db, `chats/${chatId}/typing/${currentUser.uid}`);

    // Set true
    set(myTypingRef, true);
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        // Set false after delay
        set(myTypingRef, false);
    }, 2000);
}

function listenForTyping(chatId) {
    const partnerTypingRef = ref(db, `chats/${chatId}/typing/${selectedUser.uid}`);
    
    // onValue fires whenever the value changes
    onValue(partnerTypingRef, (snapshot) => {
        const isTyping = snapshot.val();
        if (isTyping) {
            headerStatusContainer.classList.add('typing-active');
            headerStatusContainer.classList.remove('typing-inactive');
            typingIndicator.innerHTML = `<div class="typing-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div> typing...`;
        } else {
            headerStatusContainer.classList.remove('typing-active');
            headerStatusContainer.classList.add('typing-inactive');
        }
    });
}

// --- REPLY ---
function startReply(id, text, senderName) {
    replyTarget = { id, text, senderName };
    replyPreview.classList.remove('hidden');
    replyText.textContent = text;
    msgInput.focus();
}
closeReplyBtn.addEventListener('click', () => { replyTarget = null; replyPreview.classList.add('hidden'); });

// --- PRESENCE SYSTEM (True Online/Offline) ---
function setupPresence(user) {
    // 1. Store user info in RTDB users node
    const userRef = ref(db, `users/${user.uid}`);
    update(userRef, {
        displayName: user.displayName,
        photoURL: user.photoURL,
        email: user.email,
        uid: user.uid
    });

    // 2. Handle Online/Offline status using .info/connected
    const myConnectionsRef = ref(db, `users/${user.uid}/connections`);
    const lastOnlineRef = ref(db, `users/${user.uid}/lastOnline`);
    const connectedRef = ref(db, '.info/connected');

    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            // We're connected (or reconnected)!
            const con = push(myConnectionsRef);
            
            // When I disconnect, remove this connection
            onDisconnect(con).remove();
            
            // When I disconnect, update the last time I was seen
            onDisconnect(lastOnlineRef).set(serverTimestamp());
            
            // Add this device to my connections list
            set(con, true);
        }
    });
}

function monitorUserStatus(uid) {
    const userConnectionsRef = ref(db, `users/${uid}/connections`);
    
    onValue(userConnectionsRef, (snap) => {
        // If 'connections' exists and has children, they are online
        if (snap.exists()) {
            headerStatus.innerHTML = `<span class="status-dot" style="background:#ff5e9a"></span> Online`;
            headerStatus.style.color = "#ffebf3";
        } else {
            headerStatus.innerHTML = `<span class="status-dot" style="background:#666"></span> Offline`;
            headerStatus.style.color = "#666";
        }
    });
}

// --- VISIBILITY ---
document.addEventListener("visibilitychange", () => {
    isPageVisible = document.visibilityState === 'visible';
    if (isPageVisible) document.title = "ClosedDoor";
});

function requestNotifyPermission() {
    if ("Notification" in window && Notification.permission !== "granted") Notification.requestPermission();
}

// --- AUTH ---
loginBtn.addEventListener('click', async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); requestNotifyPermission(); } catch (e) { console.error(e); }
});
logoutBtn.addEventListener('click', () => { signOut(auth); location.reload(); });

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loginScreen.classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('my-avatar').src = user.photoURL;
        document.getElementById('my-name').textContent = user.displayName.split(' ')[0];
        
        setupPresence(user);
        loadUsers();
    } else {
        currentUser = null;
        loginScreen.classList.remove('hidden');
        document.getElementById('app').classList.add('hidden');
    }
});

function loadUsers() {
    const usersRef = ref(db, 'users');
    onValue(usersRef, (snapshot) => {
        userListEl.innerHTML = '';
        snapshot.forEach((childSnap) => {
            const user = childSnap.val();
            if (user.uid !== currentUser.uid) {
                const div = document.createElement('div');
                div.className = 'user-item';
                div.innerHTML = `<img src="${user.photoURL}" class="user-avatar"><div class="user-info"><h4>${user.displayName}</h4><p>Tap to chat</p></div>`;
                div.addEventListener('click', () => selectChat(user));
                userListEl.appendChild(div);
            }
        });
    });
}

function selectChat(user) {
    selectedUser = user;
    emptyState.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    document.body.classList.add('mobile-chat-active');
    
    headerAvatar.src = user.photoURL;
    headerName.textContent = user.displayName;
    headerStatusContainer.classList.remove('typing-active');
    headerStatusContainer.classList.add('typing-inactive');
    
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    monitorUserStatus(user.uid);
    listenForTyping(chatId); 
    loadMessages(chatId);
}

// --- LOAD MESSAGES (RTDB) ---
function loadMessages(chatId) {
    msgContainer.innerHTML = '';
    lastDateRendered = null;
    
    // Reference to messages node
    const chatMsgsRef = query(ref(db, `chats/${chatId}/messages`), orderByChild('timestamp'));
    
    // Listen for new messages added (Fires for existing ones first, then new ones)
    onValue(chatMsgsRef, (snapshot) => {
        msgContainer.innerHTML = ''; // Clear to prevent duplication on full reload
        lastDateRendered = null; // Reset date tracking

        snapshot.forEach((childSnapshot) => {
            const msg = childSnapshot.val();
            const msgId = childSnapshot.key;
            renderMessage(msg, msgId, chatId);
            
            // Mark as seen if it's not mine and not seen
            if (msg.senderId !== currentUser.uid && msg.status !== 'seen' && isPageVisible) {
                update(ref(db, `chats/${chatId}/messages/${msgId}`), { status: 'seen' });
            }
        });
        scrollToBottom();
    });
}

function renderMessage(msg, msgId, chatId) {
    // Date Divider
    if (msg.timestamp) {
        const dateObj = new Date(msg.timestamp);
        const dateStr = dateObj.toDateString();
        if (dateStr !== lastDateRendered) {
            const div = document.createElement('div');
            div.className = 'date-divider';
            div.innerHTML = `<span>${dateObj.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' })}</span>`;
            msgContainer.appendChild(div);
            lastDateRendered = dateStr;
        }
    }

    const div = document.createElement('div');
    const isMe = msg.senderId === currentUser.uid;
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    div.id = `msg-${msgId}`;

    // Formatting Time
    const date = msg.timestamp ? new Date(msg.timestamp) : new Date();
    const time = date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');

    // Ticks
    let tickHtml = '';
    if (isMe) {
        let tickClass = 'tick-sent'; let tickIcon = 'fa-check';
        if (msg.status === 'seen') { tickClass = 'tick-seen'; tickIcon = 'fa-check-double'; }
        tickHtml = `<i class="fas ${tickIcon} tick-icon ${tickClass}"></i>`;
    }

    let reactionHtml = msg.reaction ? `<span class="reaction-badge">${msg.reaction}</span>` : '';
    let replyHtml = msg.replyTo ? `<div class="reply-quote"><strong>${msg.replyTo.senderName}</strong>: ${msg.replyTo.text}</div>` : '';

    div.innerHTML = `
        ${replyHtml}
        ${msg.text}
        <span class="timestamp">${time} ${tickHtml}</span>
        ${reactionHtml}
        <div class="msg-actions">
            <button class="action-btn reply-action"><i class="fas fa-reply"></i></button>
            <button class="action-btn react-action"><i class="far fa-smile"></i></button>
        </div>
    `;

    // Listeners
    div.querySelector('.react-action').addEventListener('click', (e) => {
        e.stopPropagation();
        reactionMenu.classList.remove('hidden');
        reactionMenu.style.top = (e.clientY - 50) + 'px';
        reactionMenu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
        reactionMenu.setAttribute('data-msg-id', msgId);
    });

    div.querySelector('.reply-action').addEventListener('click', (e) => {
        e.stopPropagation();
        startReply(msgId, msg.text, isMe ? "You" : selectedUser.displayName);
    });

    div.addEventListener('dblclick', () => {
        const emoji = msg.reaction ? null : "❤️";
        update(ref(db, `chats/${chatId}/messages/${msgId}`), { reaction: emoji });
    });

    msgContainer.appendChild(div);
}

// --- SEND MESSAGE ---
msgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text || !selectedUser) return;

    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    
    // Instant UI clear
    msgInput.value = '';
    msgInput.focus();
    emojiPicker.classList.add('hidden');
    
    let replyData = null;
    if (replyTarget) {
        replyData = replyTarget;
        replyTarget = null;
        replyPreview.classList.add('hidden');
    }

    // RTDB Push
    const newMsgRef = push(ref(db, `chats/${chatId}/messages`));
    await set(newMsgRef, {
        text: text,
        senderId: currentUser.uid,
        timestamp: serverTimestamp(),
        status: 'sent',
        reaction: null,
        replyTo: replyData
    });
    
    scrollToBottom();
});

function scrollToBottom() { setTimeout(() => { msgContainer.scrollTop = msgContainer.scrollHeight; }, 50); }
