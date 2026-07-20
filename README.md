### **Firs start from full code** 
### **Do not use for anything important, this is a pet project that cannot guarantee security, made with AI**
1. Download and install OBS, Tailscale/NetBird, and the MediaMTX server.
2. Log in to Tailscale.
3. Start the MediaMTX server and copy the WebRTC port from the terminal.
4. Enter your WebRTC port and any stream key into the OBS stream settings.
5. Open a terminal and run: `tailscale serve --bg 3000` and `tailscale serve --bg --https=8443 <your-webrtc-port>`. This makes the messenger and stream accessible within the Tailscale network (the first link is the messenger page, the second is the stream); to close the ports, run `tailscale serve reset`.
6. Share network access with friends.
7. Install the dependencies from `requirements.txt`.
8. Run `app.py`, then execute `cd client` and run `npm run dev`; the links to the messenger page will then become available.
9. Create a room and start the stream by pasting the link from Tailscale.
