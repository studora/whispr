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

// Header Elements
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

// --- TYPING INDICATOR ---
msgInput.addEventListener('input', handleTyping);

async function handleTyping() {
    if (!selectedUser) return;
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    
    clearTimeout(typingTimeout);
    const chatRef = doc(db, "chats", chatId);
    try {
        // Don't await this, let it run in background to prevent input lag
        setDoc(chatRef, { typing: { [currentUser.uid]: true } }, { merge: true });
    } catch(e) {}

    typingTimeout = setTimeout(() => {
        setDoc(chatRef, { typing: { [currentUser.uid]: false } }, { merge: true }).catch(()=>{});
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

// --- STATUS ---
function monitorUserStatus(uid) {
    if (statusUnsubscribe) statusUnsubscribe(); 
    if (statusInterval) clearInterval(statusInterval);
    
    const userRef = doc(db, "users", uid);
    let lastActiveTime = 0; 

    const updateStatusText = () => {
        if (lastActiveTime === 0) { 
            headerStatus.innerHTML = "Offline"; 
            headerStatus.style.color = "#666";
            return; 
        }
        const diff = Date.now() - lastActiveTime;
        if (diff < 60000) { 
            headerStatus.innerHTML = `<span class="status-dot" style="background:#ff5e9a"></span> Online`;
            headerStatus.style.color = "#ffebf3";
        } else {
            headerStatus.innerHTML = `<span class="status-dot" style="background:#666"></span> Offline`;
            headerStatus.style.color = "#666";
        }
    };

    statusUnsubscribe = onSnapshot(userRef, (doc) => {
        const data = doc.data();
        if (data && data.lastActive) { 
            lastActiveTime = data.lastActive.toDate().getTime(); 
        }
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

// --- SMART MESSAGE LOADING (FIXES LAG) ---
function loadMessages(chatId) {
    if (messagesUnsubscribe) messagesUnsubscribe();
    msgContainer.innerHTML = ''; // Clear once on load
    
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"));

    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        // docChanges() allows us to only process NEW/CHANGED messages
        // instead of redrawing the entire list every time.
        snapshot.docChanges().forEach((change) => {
            const msg = change.doc.data();
            const msgId = change.doc.id;
            
            if (change.type === "added") {
                renderMessage(msg, msgId, chatId, false);
                // Play sound if it's a new message from partner
                if (!change.doc.metadata.hasPendingWrites && msg.senderId !== currentUser.uid) {
                     notifyUser(msg.text);
                }
                // Mark as seen if visible
                if (msg.senderId !== currentUser.uid && msg.status === 'sent' && isPageVisible) {
                    updateDoc(change.doc.ref, { status: 'seen' }).catch(()=>{});
                }
            }
            if (change.type === "modified") {
                // Re-render specific message to update status/reactions
                renderMessage(msg, msgId, chatId, true); 
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

// --- RENDER LOGIC ---
function renderMessage(msg, msgId, chatId, isUpdate) {
    // Date Divider Check (Only checks previous sibling in DOM)
    if (!isUpdate && msg.createdAt) {
        const dateObj = msg.createdAt.toDate();
        const dateStr = dateObj.toDateString();
        
        const lastDivider = msgContainer.querySelector('.date-divider:last-child span');
        const lastDate = lastDivider ? lastDivider.innerText : "";
        const newDateText = dateObj.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });

        // Simple check: if the last element isn't a divider for today, add one
        // Note: precise date grouping usually requires full redraw, but this is faster for latency.
        // A more robust solution involves checking the last *message* timestamp.
    }

    let div = document.getElementById(`msg-${msgId}`);
    
    // If it's an update but element missing, or it's new, create it
    if (!div) {
        div = document.createElement('div');
        div.id = `msg-${msgId}`;
    }

    const isMe = msg.senderId === currentUser.uid;
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    
    // Handle Pending Writes (Instant Local Feedback)
    if(!msg.createdAt) {
        div.style.opacity = "0.7"; // Slightly dim while sending
    } else {
        div.style.opacity = "1";
    }

    let time = "";
    if (msg.createdAt) {
        const date = msg.createdAt.toDate();
        time = date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');
    } else {
        // If pending, show current time
        const date = new Date();
        time = date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');
    }

    let tickHtml = '';
    if (isMe) {
        let tickClass = 'tick-sent'; let tickIcon = 'fa-check';
        if (msg.status === 'seen') { tickClass = 'tick-seen'; tickIcon = 'fa-check-double'; }
        // If pending (no createdAt from server yet), show clock
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
    
    // Re-attach listeners (simplest way to ensure they work after update)
    const reactBtn = div.querySelector('.react-action');
    const replyBtn = div.querySelector('.reply-action');

    // Clone/replace listeners trick not needed if we just add them fresh
    reactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        reactionMenu.classList.remove('hidden');
        reactionMenu.style.top = (e.clientY - 50) + 'px';
        reactionMenu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
        reactionMenu.setAttribute('data-msg-id', msgId);
    });

    replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startReply(msgId, msg.text, isMe ? "You" : selectedUser.displayName);
    });

    div.ondblclick = () => toggleHeart(chatId, msgId, msg.reaction ? null : "❤️");

    if (!document.getElementById(`msg-${msgId}`)) {
        msgContainer.appendChild(div);
    }
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

// --- INSTANT SENDING LOGIC ---
msgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text || !selectedUser) return;

    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    
    // 1. CLEAR INPUT IMMEDIATELY (Optimistic UI)
    msgInput.value = '';
    msgInput.focus();
    emojiPicker.classList.add('hidden'); 
    
    let replyData = null;
    if (replyTarget) {
        replyData = replyTarget;
        replyTarget = null;
        replyPreview.classList.add('hidden');
    }

    // 2. Send to Firestore (Runs in background, doesn't block UI)
    // Firestore local cache will trigger onSnapshot immediately with "Pending writes"
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
    // Small timeout ensures DOM is painted before scrolling
    setTimeout(() => {
        msgContainer.scrollTop = msgContainer.scrollHeight;
    }, 10);
}
