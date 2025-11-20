import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    getDatabase, ref, set, push, onValue, serverTimestamp, 
    query, orderByChild, update, onDisconnect, 
    limitToLast, onChildAdded, onChildChanged, off, get 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyDKTmbeR8vxWOimsera1WmC6a5mZc_Ewkc",
  authDomain: "closeddoor-58ac5.firebaseapp.com",
  databaseURL: "https://closeddoor-58ac5-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "closeddoor-58ac5",
  storageBucket: "closeddoor-58ac5.firebasestorage.app",
  messagingSenderId: "330800003542",
  appId: "1:330800003542:web:2d02cf0d6eb01d5bdfcc77",
  measurementId: "G-B1DJWK271Y"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app); 
const messaging = getMessaging(app);

// !!! IMPORTANT: REPLACE THIS WITH YOUR KEY FROM FIREBASE CONSOLE !!!
const VAPID_KEY = "PASTE_YOUR_GENERATED_KEY_PAIR_HERE"; 

// --- DOM Elements ---
const loginScreen = document.getElementById('login-screen');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userListEl = document.getElementById('user-list');
const chatInterface = document.getElementById('chat-interface');
const emptyState = document.getElementById('empty-state');
const msgForm = document.getElementById('message-form');
const msgInput = document.getElementById('message-input');
const msgContainer = document.getElementById('messages-container');

const headerAvatar = document.getElementById('header-avatar');
const headerName = document.getElementById('header-name');
const headerStatusContainer = document.getElementById('header-status-container');
const headerStatus = document.getElementById('header-status');
const typingIndicator = document.getElementById('typing-indicator');

const emojiToggle = document.getElementById('emoji-toggle');
const emojiPicker = document.getElementById('emoji-picker');
const backBtn = document.getElementById('back-btn');
const replyPreview = document.getElementById('reply-preview');
const replyText = document.getElementById('reply-text');
const closeReplyBtn = document.getElementById('close-reply');
const reactionMenu = document.getElementById('reaction-menu');

// Create Audio for Ping
const pingSound = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
pingSound.volume = 0.5;

// --- State Variables ---
let currentUser = null;
let selectedUser = null;
let isPageVisible = !document.hidden;
let replyTarget = null; 
let typingTimeout = null;
let lastDateRendered = null;
let unreadCount = 0; 

// Listeners Trackers
let currentChatQuery = null;
let onAddedListener = null;
let onChangedListener = null;

// --- NOTIFICATION LOGIC (Foreground + Background Token) ---

// 1. Request Permission & Save Token for Backend (Push)
async function setupPushNotifications(user) {
    try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            // Get the unique ID for this device
            const token = await getToken(messaging, { vapidKey: VAPID_KEY });
            if (token) {
                // Save token to DB so Cloud Function can find it
                const tokenRef = ref(db, `users/${user.uid}/fcmToken`);
                set(tokenRef, token);
                console.log("Notification Token Saved.");
            }
        }
    } catch (error) {
        console.error("Notification permission denied:", error);
    }

    // Handle foreground messages (when app is open)
    onMessage(messaging, (payload) => {
        // We rely on onChildAdded for UI updates, but we can log this
        console.log("Foreground push received:", payload);
    });
}

// 2. Handle Browser Tab Title (Pink Dot)
document.addEventListener("visibilitychange", () => {
    isPageVisible = !document.hidden;
    if (isPageVisible) {
        resetNotifications();
    }
});

function resetNotifications() {
    unreadCount = 0;
    document.title = "ClosedDoor"; 
}

function triggerLocalNotification(text, senderName) {
    // Play Sound
    pingSound.play().catch(e => {}); 

    // Change Title
    unreadCount++;
    document.title = `🔴 (${unreadCount}) ${senderName}`;

    // System Notification (Desktop/Android Nav Bar when minimized)
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
        new Notification(`New message from ${senderName}`, {
            body: text,
            icon: "https://cdn-icons-png.flaticon.com/512/1077/1077012.png",
            tag: "closeddoor-msg"
        });
    }
}

// --- EVENT LISTENERS ---

backBtn.addEventListener('click', () => {
    document.body.classList.remove('mobile-chat-active');
    setTimeout(() => chatInterface.classList.add('hidden'), 300);
    
    if (currentChatQuery) {
        off(currentChatQuery, 'child_added', onAddedListener);
        off(currentChatQuery, 'child_changed', onChangedListener);
        currentChatQuery = null;
    }
    selectedUser = null;
    resetNotifications();
});

emojiToggle.addEventListener('click', (e) => { e.stopPropagation(); emojiPicker.classList.toggle('hidden'); });
document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => { msgInput.value += btn.textContent; msgInput.focus(); handleTyping(); });
});
document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && !emojiToggle.contains(e.target)) emojiPicker.classList.add('hidden');
    if (!reactionMenu.contains(e.target)) reactionMenu.classList.add('hidden');
});

document.querySelectorAll('#reaction-menu span').forEach(span => {
    span.addEventListener('click', async () => {
        const r = span.getAttribute('data-r');
        const msgId = reactionMenu.getAttribute('data-msg-id');
        const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
        const msgRef = ref(db, `chats/${chatId}/messages/${msgId}`);
        update(msgRef, { reaction: r });
        reactionMenu.classList.add('hidden');
    });
});

msgInput.addEventListener('input', handleTyping);

function handleTyping() {
    if (!selectedUser) return;
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    const myTypingRef = ref(db, `chats/${chatId}/typing/${currentUser.uid}`);
    set(myTypingRef, true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { set(myTypingRef, false); }, 2000);
}

function listenForTyping(chatId) {
    const partnerTypingRef = ref(db, `chats/${chatId}/typing/${selectedUser.uid}`);
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

function startReply(id, text, senderName) {
    replyTarget = { id, text, senderName };
    replyPreview.classList.remove('hidden');
    replyText.textContent = text;
    msgInput.focus();
}
closeReplyBtn.addEventListener('click', () => { replyTarget = null; replyPreview.classList.add('hidden'); });

function setupPresence(user) {
    const userRef = ref(db, `users/${user.uid}`);
    update(userRef, { displayName: user.displayName, photoURL: user.photoURL, email: user.email, uid: user.uid });

    const myConnectionsRef = ref(db, `users/${user.uid}/connections`);
    const lastOnlineRef = ref(db, `users/${user.uid}/lastOnline`);
    const connectedRef = ref(db, '.info/connected');

    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            const con = push(myConnectionsRef);
            onDisconnect(con).remove();
            onDisconnect(lastOnlineRef).set(serverTimestamp());
            set(con, true);
        }
    });
}

function monitorUserStatus(uid) {
    const userConnectionsRef = ref(db, `users/${uid}/connections`);
    onValue(userConnectionsRef, (snap) => {
        if (snap.exists()) {
            headerStatus.innerHTML = `<span class="status-dot" style="background:#ff5e9a"></span> Online`;
            headerStatus.style.color = "#ffebf3";
        } else {
            headerStatus.innerHTML = `<span class="status-dot" style="background:#666"></span> Offline`;
            headerStatus.style.color = "#666";
        }
    });
}

loginBtn.addEventListener('click', async () => {
    try { 
        await signInWithPopup(auth, new GoogleAuthProvider()); 
    } catch (e) { console.error(e); }
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
        
        // Enable Notifications
        setupPushNotifications(user);
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
                div.id = `user-item-${user.uid}`;
                div.innerHTML = `<img src="${user.photoURL}" class="user-avatar"><div class="user-info"><h4>${user.displayName}</h4><p>Tap to chat</p></div>`;
                div.addEventListener('click', () => selectChat(user));
                userListEl.appendChild(div);
            }
        });
    });
}

function selectChat(user) {
    selectedUser = user;
    // Remove badge
    const badge = document.querySelector(`#user-item-${user.uid} .unread-badge`);
    if(badge) badge.remove();
    
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

// ============================================
//   OPTIMIZED MESSAGE LOADING + NOTIFICATIONS
// ============================================

function loadMessages(chatId) {
    if (currentChatQuery) {
        off(currentChatQuery, 'child_added', onAddedListener);
        off(currentChatQuery, 'child_changed', onChangedListener);
    }

    msgContainer.innerHTML = '';
    lastDateRendered = null;
    resetNotifications(); 
    
    currentChatQuery = query(ref(db, `chats/${chatId}/messages`), orderByChild('timestamp'), limitToLast(75));

    onAddedListener = onChildAdded(currentChatQuery, (snapshot) => {
        const msg = snapshot.val();
        const msgId = snapshot.key;
        appendSingleMessage(msg, msgId, chatId);

        // --- NOTIFICATION LOGIC ---
        if (msg.senderId !== currentUser.uid) {
            // 1. If Hidden: Trigger Notification
            if (document.hidden) {
                triggerLocalNotification(msg.text, selectedUser.displayName);
            } 
            // 2. If Visible: Mark as Seen immediately
            else {
                if (msg.status !== 'seen') {
                    update(ref(db, `chats/${chatId}/messages/${msgId}`), { status: 'seen' });
                }
            }
        }
        
        scrollToBottom();
    });

    onChangedListener = onChildChanged(currentChatQuery, (snapshot) => {
        const msg = snapshot.val();
        const msgId = snapshot.key;
        updateMessageElement(msg, msgId);
    });
}

function appendSingleMessage(msg, msgId, chatId) {
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

    div.innerHTML = buildMessageHTML(msg, isMe);
    attachMessageEvents(div, msg, msgId, chatId, isMe);
    msgContainer.appendChild(div);
}

function updateMessageElement(msg, msgId) {
    const div = document.getElementById(`msg-${msgId}`);
    if (!div) return;
    const isMe = msg.senderId === currentUser.uid;
    div.innerHTML = buildMessageHTML(msg, isMe);
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    attachMessageEvents(div, msg, msgId, chatId, isMe);
}

function buildMessageHTML(msg, isMe) {
    const date = msg.timestamp ? new Date(msg.timestamp) : new Date();
    const time = date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');
    let tickHtml = '';
    if (isMe) {
        let tickClass = 'tick-sent'; let tickIcon = 'fa-check';
        if (msg.status === 'seen') { tickClass = 'tick-seen'; tickIcon = 'fa-check-double'; }
        tickHtml = `<i class="fas ${tickIcon} tick-icon ${tickClass}"></i>`;
    }
    let reactionHtml = msg.reaction ? `<span class="reaction-badge">${msg.reaction}</span>` : '';
    let replyHtml = msg.replyTo ? `<div class="reply-quote"><strong>${msg.replyTo.senderName}</strong>: ${msg.replyTo.text}</div>` : '';
    return `
        ${replyHtml}
        ${msg.text}
        <span class="timestamp">${time} ${tickHtml}</span>
        ${reactionHtml}
        <div class="msg-actions">
            <button class="action-btn reply-action"><i class="fas fa-reply"></i></button>
            <button class="action-btn react-action"><i class="far fa-smile"></i></button>
        </div>
    `;
}

function attachMessageEvents(div, msg, msgId, chatId, isMe) {
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
}

msgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text || !selectedUser) return;
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    
    msgInput.value = '';
    msgInput.focus();
    emojiPicker.classList.add('hidden');
    
    let replyData = null;
    if (replyTarget) { replyData = replyTarget; replyTarget = null; replyPreview.classList.add('hidden'); }

    const newMsgRef = push(ref(db, `chats/${chatId}/messages`));
    set(newMsgRef, {
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
