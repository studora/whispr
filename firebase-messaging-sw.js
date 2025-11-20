importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

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

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// 1. Handle Background Messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  // Extract data from the "data" payload we sent from the server
  const { title, body, icon, click_action } = payload.data;

  const notificationOptions = {
    body: body,
    icon: icon,
    data: {
      url: click_action // Store the URL to open later
    },
    tag: 'closeddoor-chat' // Prevents spamming multiple notifications
  };

  return self.registration.showNotification(title, notificationOptions);
});

// 2. Handle Notification Clicks
self.addEventListener('notificationclick', function(event) {
  console.log('Notification clicked');
  event.notification.close(); // Close the notification

  // Get the URL we stored in the data object
  const urlToOpen = event.notification.data?.url || "https://closeddoor-58ac5.web.app";

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Check if the tab is already open
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('closeddoor-58ac5.web.app') && 'focus' in client) {
          return client.focus();
        }
      }
      // If not open, open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
