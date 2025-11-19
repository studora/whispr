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
let messagesUnsubscribe = null;
let statusUnsubscribe = null;
let statusInterval = null; 
let isPageVisible = true;
let replyTarget = null; 
let typingTimeout = null;
let lastDateRendered = null;

// --- MOBILE NAV ---
backBtn.addEventListener('click', () => {
    document.body.classList.remove('mobile-chat-active');
    setTimeout(() => chatInterface.classList.add('hidden'), 300);
    if (messagesUnsubscribe) messagesUnsubscribe();
    if (statusUnsubscribe) statusUnsubscribe();
    if (statusInterval) clearInterval(statusInterval);
    selectedUser = null;
});

// --- EMOJI & MENU ---
emojiToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle('hidden');
});

document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        msgInput.value += btn.textContent;
        msgInput.focus();
        handleTyping();
    });
});

document.querySelectorAll('#reaction-menu span').forEach(span => {
    span.addEventListener('click', async () => {
        const r = span.getAttribute('data-r');
        const msgId = reactionMenu.getAttribute('data-msg-id');
        const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
        await toggleHeart(chatId, msgId, r);
        reactionMenu.classList.add('hidden');
    });
});

document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && !emojiToggle.contains(e.target)) emojiPicker.classList.add('hidden');
    if (!reactionMenu.contains(e.target)) reactionMenu.classList.add('hidden');
});

// --- TYPING ---
msgInput.addEventListener('input', handleTyping);

async function handleTyping() {
    if (!selectedUser) return;
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    clearTimeout(typingTimeout);
    const chatRef = doc(db, "chats", chatId);
    
    // Don't await, fire and forget
    try { setDoc(chatRef, { typing: { [currentUser.uid]: true } }, { merge: true }); } catch(e) {}

    typingTimeout = setTimeout(() => {
        try { setDoc(chatRef, { typing: { [currentUser.uid]: false } }, { merge: true }); } catch(e) {}
    }, 2000);
}

function listenForTyping(chatId) {
    const chatRef = doc(db, "chats", chatId);
    onSnapshot(chatRef, (docSnap) => {
        if(docSnap.exists()) {
            const data = docSnap.data();
            const isPartnerTyping = data.typing && data.typing[selectedUser.uid] === true;
            if (isPartnerTyping) {
                headerStatusContainer.classList.add('typing-active');
                headerStatusContainer.classList.remove('typing-inactive');
                typingIndicator.innerHTML = `<div class="typing-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div> typing...`;
            } else {
                headerStatusContainer.classList.remove('typing-active');
                headerStatusContainer.classList.add('typing-inactive');
            }
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

closeReplyBtn.addEventListener('click', () => {
    replyTarget = null;
    replyPreview.classList.add('hidden');
});

// --- HEARTBEAT ---
function startHeartbeat(user) {
    updateMyStatus(user.uid);
    setInterval(() => { updateMyStatus(user.uid); }, 30000); // Update every 30s is enough
}
async function updateMyStatus(uid) {
    try { await setDoc(doc(db, "users", uid), { lastActive: serverTimestamp() }, { merge: true }); } catch (e) {}
}

function monitorUserStatus(uid) {
    if (statusUnsubscribe) statusUnsubscribe(); 
    if (statusInterval) clearInterval(statusInterval);
    const userRef = doc(db, "users", uid);
    let lastActiveTime = 0; 

    const updateStatusText = () => {
        if (lastActiveTime === 0) { 
            headerStatus.innerHTML = "Offline"; headerStatus.style.color = "#666"; return; 
        }
        const diff = Date.now() - lastActiveTime;
        if (diff < 65000) { // 65 seconds buffer
            headerStatus.innerHTML = `<span class="status-dot" style="background:#ff5e9a"></span> Online`;
            headerStatus.style.color = "#ffebf3";
        } else {
            headerStatus.innerHTML = `<span class="status-dot" style="background:#666"></span> Offline`;
            headerStatus.style.color = "#666";
        }
    };

    statusUnsubscribe = onSnapshot(userRef, (doc) => {
        const data = doc.data();
        if (data && data.lastActive) { lastActiveTime = data.lastActive.toDate().getTime(); }
        updateStatusText(); 
    });
    statusInterval = setInterval(updateStatusText, 10000);
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

function loadUsers() {
    const q = query(collection(db, "users"));
    onSnapshot(q, (snapshot) => {
        userListEl.innerHTML = '';
        snapshot.forEach((doc) => {
            const user = doc.data();
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

// --- INSTANT MESSAGES (THE FIX) ---
function loadMessages(chatId) {
    if (messagesUnsubscribe) messagesUnsubscribe();
    msgContainer.innerHTML = '';
    lastDateRendered = null;

    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"));

    // KEY FIX: { includeMetadataChanges: true }
    // This tells Firebase: "Fire this event IMMEDIATELY when I send a message, even if server hasn't replied."
    messagesUnsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
        
        snapshot.docChanges().forEach((change) => {
            const msg = change.doc.data();
            const msgId = change.doc.id;

            if (change.type === "added") {
                renderMessage(msg, msgId, chatId);
                
                // If it's a new incoming message (not mine, and not local)
                if (msg.senderId !== currentUser.uid && !change.doc.metadata.hasPendingWrites) {
                     notifyUser(msg.text);
                }
                // Mark as seen
                if (msg.senderId !== currentUser.uid && msg.status === 'sent' && isPageVisible && !change.doc.metadata.hasPendingWrites) {
                    updateDoc(change.doc.ref, { status: 'seen' }).catch(()=>{});
                }
            }
            if (change.type === "modified") {
                // Update existing bubble (e.g., tick change, reaction)
                updateMessageElement(msg, msgId);
            }
        });
        
        scrollToBottom();
    });
}

async function markCurrentChatSeen() {
    if (!currentUser || !selectedUser) return;
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    const q = query(collection(db, "chats", chatId, "messages"), where("senderId", "==", selectedUser.uid), where("status", "==", "sent"));
    const snapshot = await getDocs(q);
    snapshot.forEach((docSnap) => { updateDoc(docSnap.ref, { status: 'seen' }).catch(()=>{}); });
}

function renderMessage(msg, msgId, chatId) {
    // Avoid duplicates
    if (document.getElementById(`msg-${msgId}`)) return;

    // Logic for Date Headers
    if (msg.createdAt) {
        const dateObj = msg.createdAt.toDate();
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
    div.id = `msg-${msgId}`; // Assign ID for updates
    fillMessageContent(div, msg, msgId, chatId);
    
    msgContainer.appendChild(div);
}

function updateMessageElement(msg, msgId) {
    const div = document.getElementById(`msg-${msgId}`);
    if (div) {
        // Just re-fill the inner HTML to update reaction/ticks
        const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
        fillMessageContent(div, msg, msgId, chatId);
    }
}

function fillMessageContent(div, msg, msgId, chatId) {
    const isMe = msg.senderId === currentUser.uid;
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    
    let time = "";
    if (msg.createdAt) {
        const date = msg.createdAt.toDate();
        time = date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');
    } else {
        // If "Pending Writes" (Instant send), use local time
        const date = new Date();
        time = date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');
    }

    let tickHtml = '';
    if (isMe) {
        let tickClass = 'tick-sent'; let tickIcon = 'fa-check';
        if (msg.status === 'seen') { tickClass = 'tick-seen'; tickIcon = 'fa-check-double'; }
        // If createdAt is null, it means it's still sending (Latency Compensation)
        if (!msg.createdAt) tickHtml = `<i class="far fa-clock tick-icon"></i>`; 
        else tickHtml = `<i class="fas ${tickIcon} tick-icon ${tickClass}"></i>`;
    }

    let reactionHtml = msg.reaction ? `<span class="reaction-badge">${msg.reaction}</span>` : '';
    
    let replyHtml = '';
    if(msg.replyTo) {
        replyHtml = `<div class="reply-quote"><strong>${msg.replyTo.senderName}</strong>: ${msg.replyTo.text}</div>`;
    }

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

    // Re-bind events
    const reactBtn = div.querySelector('.react-action');
    const replyBtn = div.querySelector('.reply-action');

    if(reactBtn) reactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        reactionMenu.classList.remove('hidden');
        reactionMenu.style.top = (e.clientY - 50) + 'px';
        reactionMenu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
        reactionMenu.setAttribute('data-msg-id', msgId);
    });

    if(replyBtn) replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startReply(msgId, msg.text, isMe ? "You" : selectedUser.displayName);
    });

    div.ondblclick = () => toggleHeart(chatId, msgId, msg.reaction ? null : "❤️");
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

// --- SEND BUTTON ---
msgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text || !selectedUser) return;

    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    
    // 1. Clear Input IMMEDIATELY (Zero Delay)
    msgInput.value = '';
    msgInput.focus();
    emojiPicker.classList.add('hidden'); 
    
    let replyData = null;
    if (replyTarget) {
        replyData = replyTarget;
        replyTarget = null;
        replyPreview.classList.add('hidden');
    }

    // 2. Add Doc. Because of "includeMetadataChanges: true" above, 
    // the snapshot listener will fire INSTANTLY for this local change.
    try {
        await addDoc(collection(db, "chats", chatId, "messages"), {
            text: text,
            senderId: currentUser.uid,
            createdAt: serverTimestamp(),
            reaction: null,
            status: 'sent',
            replyTo: replyData
        });
        scrollToBottom();
    } catch (e) { console.error(e); }
});

function scrollToBottom() { 
    setTimeout(() => { msgContainer.scrollTop = msgContainer.scrollHeight; }, 50);
}
