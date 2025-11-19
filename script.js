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
const headerStatusContainer = document.getElementById('header-status-container'); // Wrapper
const headerStatus = document.getElementById('header-status'); // Online/Offline text
const typingIndicator = document.getElementById('typing-indicator'); // The dots

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
let lastMessageDate = null; 
let replyTarget = null; 
let typingTimeout = null;

// --- MOBILE NAVIGATION ---
backBtn.addEventListener('click', () => {
    document.body.classList.remove('mobile-chat-active');
    setTimeout(() => chatInterface.classList.add('hidden'), 300);
    // Clean up listeners
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

// Handle Reaction Click
document.querySelectorAll('#reaction-menu span').forEach(span => {
    span.addEventListener('click', async () => {
        const r = span.getAttribute('data-r');
        const msgId = reactionMenu.getAttribute('data-msg-id');
        const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
        
        await toggleHeart(chatId, msgId, r);
        reactionMenu.classList.add('hidden');
    });
});

// Close menus on outside click
document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && !emojiToggle.contains(e.target)) emojiPicker.classList.add('hidden');
    if (!reactionMenu.contains(e.target)) reactionMenu.classList.add('hidden');
});

// --- TYPING INDICATOR LOGIC (FIXED) ---

msgInput.addEventListener('input', handleTyping);

// 1. Tell DB I am typing
async function handleTyping() {
    if (!selectedUser) return;
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    
    clearTimeout(typingTimeout);
    
    // Optimistic check to reduce writes
    // (In a real app, we'd debounce this write too, but this is fine for now)
    const chatRef = doc(db, "chats", chatId);
    try {
        await setDoc(chatRef, { typing: { [currentUser.uid]: true } }, { merge: true });
    } catch(e) {}

    typingTimeout = setTimeout(async () => {
        try {
            await setDoc(chatRef, { typing: { [currentUser.uid]: false } }, { merge: true });
        } catch(e) {}
    }, 2000);
}

// 2. Listen for Partner typing (Controls CSS Classes)
function listenForTyping(chatId) {
    const chatRef = doc(db, "chats", chatId);
    
    onSnapshot(chatRef, (docSnap) => {
        if(docSnap.exists()) {
            const data = docSnap.data();
            
            // Check if partner is typing
            const isPartnerTyping = data.typing && data.typing[selectedUser.uid] === true;

            if (isPartnerTyping) {
                // Add class -> CSS hides 'Online' and shows 'Typing'
                headerStatusContainer.classList.add('typing-active');
                headerStatusContainer.classList.remove('typing-inactive');
                
                // Inject Discord Dots HTML
                typingIndicator.innerHTML = `
                    <div class="typing-dots">
                        <div class="dot"></div><div class="dot"></div><div class="dot"></div>
                    </div>
                    typing...
                `;
            } else {
                // Remove class -> CSS shows 'Online' and hides 'Typing'
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

// --- HEARTBEAT (Presence System) ---
function startHeartbeat(user) {
    updateMyStatus(user.uid);
    setInterval(() => { updateMyStatus(user.uid); }, 10000); 
}
async function updateMyStatus(uid) {
    try { await setDoc(doc(db, "users", uid), { lastActive: serverTimestamp() }, { merge: true }); } catch (e) {}
}

// --- STATUS MONITORING (FIXED) ---
function monitorUserStatus(uid) {
    if (statusUnsubscribe) statusUnsubscribe(); 
    if (statusInterval) clearInterval(statusInterval);
    
    const userRef = doc(db, "users", uid);
    let lastActiveTime = 0; 

    // Define update function separately
    const updateStatusText = () => {
        // Note: We ONLY update the innerHTML of #header-status here.
        // Visibility is handled by the .typing-active class in CSS.
        
        if (lastActiveTime === 0) { 
            headerStatus.innerHTML = "Offline"; 
            headerStatus.style.color = "#666";
            return; 
        }
        
        const diff = Date.now() - lastActiveTime;
        if (diff < 60000) { // 60 seconds threshold
            headerStatus.innerHTML = `<span class="status-dot" style="background:#ff5e9a"></span> Online`;
            headerStatus.style.color = "#ffebf3";
        } else {
            headerStatus.innerHTML = `<span class="status-dot" style="background:#666"></span> Offline`;
            headerStatus.style.color = "#666";
        }
    };

    // Listener for Realtime updates
    statusUnsubscribe = onSnapshot(userRef, (doc) => {
        const data = doc.data();
        if (data && data.lastActive) { 
            lastActiveTime = data.lastActive.toDate().getTime(); 
        }
        updateStatusText(); 
    });

    // Interval for local time calculation updates
    statusInterval = setInterval(updateStatusText, 10000);
}

// --- VISIBILITY & NOTIFICATIONS ---
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

// --- AUTHENTICATION ---
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

// --- USER LIST ---
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

// --- CHAT SELECTION ---
function selectChat(user) {
    selectedUser = user;
    emptyState.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    document.body.classList.add('mobile-chat-active');
    
    headerAvatar.src = user.photoURL;
    headerName.textContent = user.displayName;
    
    // Reset status container to initial state
    headerStatusContainer.classList.remove('typing-active');
    headerStatusContainer.classList.add('typing-inactive');
    
    const chatId = [currentUser.uid, selectedUser.uid].sort().join("_");
    monitorUserStatus(user.uid);
    listenForTyping(chatId); 
    loadMessages(chatId);
}

// --- MESSAGE HANDLING ---
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

    // Action Buttons
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
        
        // Position menu near mouse/touch
        reactionMenu.style.top = (e.clientY - 50) + 'px';
        reactionMenu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px'; // prevent overflow right
        
        reactionMenu.setAttribute('data-msg-id', msgId);
    });

    // Reply Trigger
    div.querySelector('.reply-action').addEventListener('click', (e) => {
        e.stopPropagation();
        startReply(msgId, msg.text, isMe ? "You" : selectedUser.displayName);
    });

    // Double tap heart
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

// --- SENDING MESSAGES ---
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
            replyTo: replyData
        });
        scrollToBottom();
    } catch (e) { console.error(e); }
});

function scrollToBottom() { msgContainer.scrollTop = msgContainer.scrollHeight; }
