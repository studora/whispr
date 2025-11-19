import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, setDoc, doc, where } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// --- 1. PASTE YOUR FIREBASE CONFIG HERE ---
const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
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

// State
let currentUser = null;
let selectedUser = null;
let messagesUnsubscribe = null;

// --- AUTHENTICATION ---
loginBtn.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Login failed", error);
    }
});

logoutBtn.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        loginScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        
        // Set My Profile UI
        document.getElementById('my-avatar').src = user.photoURL;
        document.getElementById('my-name').textContent = user.displayName.split(' ')[0];

        // Save User to Firestore (so others can see me)
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            displayName: user.displayName,
            photoURL: user.photoURL,
            email: user.email,
            lastActive: serverTimestamp()
        });

        loadUsers();
    } else {
        currentUser = null;
        loginScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
    }
});

// --- LOAD USER LIST ---
function loadUsers() {
    const q = query(collection(db, "users"));
    onSnapshot(q, (snapshot) => {
        userListEl.innerHTML = '';
        snapshot.forEach((doc) => {
            const user = doc.data();
            // Don't show myself in the list
            if (user.uid !== currentUser.uid) {
                const div = document.createElement('div');
                div.className = 'user-item';
                div.innerHTML = `
                    <img src="${user.photoURL}" class="user-avatar">
                    <div class="user-info">
                        <h4>${user.displayName}</h4>
                        <p>Click to chat</p>
                    </div>
                `;
                div.addEventListener('click', () => selectChat(user));
                userListEl.appendChild(div);
            }
        });
    });
}

// --- SELECT CHAT ---
function selectChat(user) {
    selectedUser = user;
    
    // Update UI
    emptyState.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    document.getElementById('header-avatar').src = user.photoURL;
    document.getElementById('header-name').textContent = user.displayName;
    
    // Generate Unique Chat ID (Alphabetical Sort ensures ID is same for both users)
    const chatId = getChatId(currentUser.uid, selectedUser.uid);

    loadMessages(chatId);
}

function getChatId(uid1, uid2) {
    return [uid1, uid2].sort().join("_");
}

// --- MESSAGING LOGIC ---
function loadMessages(chatId) {
    // Unsubscribe from previous listener if exists
    if (messagesUnsubscribe) messagesUnsubscribe();

    msgContainer.innerHTML = ''; // Clear old messages

    const q = query(
        collection(db, "chats", chatId, "messages"), 
        orderBy("createdAt", "asc")
    );

    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        msgContainer.innerHTML = '';
        snapshot.forEach((doc) => {
            const msg = doc.data();
            renderMessage(msg);
        });
        scrollToBottom();
    });
}

function renderMessage(msg) {
    const div = document.createElement('div');
    const isMe = msg.senderId === currentUser.uid;
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    
    // Format time
    let time = "";
    if (msg.createdAt) {
        const date = msg.createdAt.toDate();
        time = date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');
    }

    div.innerHTML = `
        ${msg.text}
        <span class="timestamp">${time}</span>
    `;
    msgContainer.appendChild(div);
}

// Send Message
msgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text || !selectedUser) return;

    const chatId = getChatId(currentUser.uid, selectedUser.uid);

    // Add message to subcollection
    await addDoc(collection(db, "chats", chatId, "messages"), {
        text: text,
        senderId: currentUser.uid,
        createdAt: serverTimestamp()
    });

    msgInput.value = '';
    scrollToBottom();
});

function scrollToBottom() {
    msgContainer.scrollTop = msgContainer.scrollHeight;
}
