class ChaosGame {
    constructor() {
        this.socket = null;
        this.player = null;
        this.room = null;
        this.gameStarted = false;
        this.voted = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        
        this.initializeSocket();
        this.bindEvents();
        this.checkURLParams();
    }
    
    initializeSocket() {
        // Auto-detect environment untuk Socket.io URL
        const isLocalhost = window.location.hostname === 'localhost' || 
                           window.location.hostname === '127.0.0.1';
        
        let socketUrl;
        if (isLocalhost) {
            socketUrl = 'http://localhost:3000';
        } else {
            // Untuk Vercel, gunakan current origin
            socketUrl = window.location.origin;
        }
        
        console.log('Connecting to:', socketUrl);
        
        this.socket = io(socketUrl, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000
        });
        
        this.setupSocketEvents();
    }
    
    setupSocketEvents() {
        // Connection events
        this.socket.on('connect', () => {
            console.log('✅ Connected to server:', this.socket.id);
            this.reconnectAttempts = 0;
            this.showNotification('Terhubung ke server!', 'success');
            
            // Update UI jika di game page
            if (document.getElementById('connectionStatus')) {
                document.getElementById('connectionStatus').textContent = 'Terhubung';
                document.getElementById('connectionStatus').className = 'status-connected';
            }
        });
        
        this.socket.on('connected', (data) => {
            console.log('Server confirmed connection:', data);
        });
        
        this.socket.on('disconnect', (reason) => {
            console.log('❌ Disconnected:', reason);
            this.showNotification('Koneksi terputus... Mencoba menyambung kembali', 'warning');
            
            if (document.getElementById('connectionStatus')) {
                document.getElementById('connectionStatus').textContent = 'Terputus';
                document.getElementById('connectionStatus').className = 'status-disconnected';
            }
        });
        
        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            this.reconnectAttempts++;
            
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.showNotification('Gagal terhubung ke server. Silakan refresh halaman.', 'error');
            }
        });
        
        this.socket.on('reconnecting', (attemptNumber) => {
            console.log(`Attempting to reconnect (${attemptNumber}/${this.maxReconnectAttempts})`);
            this.showNotification(`Mencoba menyambung kembali... (${attemptNumber})`, 'warning');
        });
        
        this.socket.on('reconnect', (attemptNumber) => {
            console.log('Reconnected after', attemptNumber, 'attempts');
            this.showNotification('Berhasil terhubung kembali!', 'success');
        });
        
        // Game events
        this.socket.on('roomCreated', this.handleRoomCreated.bind(this));
        this.socket.on('joinedRoom', this.handleJoinedRoom.bind(this));
        this.socket.on('roomUpdated', this.handleRoomUpdated.bind(this));
        this.socket.on('error', this.handleError.bind(this));
        this.socket.on('gameStarted', this.handleGameStarted.bind(this));
        this.socket.on('roleAssigned', this.handleRoleAssigned.bind(this));
        this.socket.on('gameUpdate', this.handleGameUpdate.bind(this));
        this.socket.on('secretButtonUsed', this.handleSecretButtonUsed.bind(this));
        this.socket.on('systemRepaired', this.handleSystemRepaired.bind(this));
        this.socket.on('randomEvent', this.handleRandomEvent.bind(this));
        this.socket.on('voteCasted', this.handleVoteCasted.bind(this));
        this.socket.on('playerEjected', this.handlePlayerEjected.bind(this));
        this.socket.on('voteReset', this.handleVoteReset.bind(this));
        this.socket.on('gameEnded', this.handleGameEnded.bind(this));
        this.socket.on('roomReset', this.handleRoomReset.bind(this));
        this.socket.on('chatMessage', this.handleChatMessage.bind(this));
        this.socket.on('ejected', this.handleEjected.bind(this));
        
        // Ping/pong untuk menjaga koneksi aktif
        setInterval(() => {
            if (this.socket.connected) {
                this.socket.emit('ping');
            }
        }, 30000);
    }
    
    // Event Handlers
    handleRoomCreated(data) {
        console.log('Room created:', data);
        this.player = { 
            username: data.player,
            id: this.socket.id
        };
        this.room = data.room;
        this.showRoomScreen(data.roomId);
    }
    
    handleJoinedRoom(data) {
        console.log('Joined room:', data);
        this.player = { 
            username: data.player,
            id: this.socket.id
        };
        this.room = data.room;
        this.showRoomScreen(data.roomId);
    }
    
    handleRoomUpdated(data) {
        console.log('Room updated:', data);
        this.updatePlayerList(data.players);
        this.updatePlayerCount(data.playerCount || data.players.length);
        
        // Update UI elements if they exist
        if (document.getElementById('playerCount')) {
            document.getElementById('playerCount').textContent = data.players.length;
        }
        
        if (document.getElementById('totalPlayers')) {
            document.getElementById('totalPlayers').textContent = data.players.length;
        }
        
        // Update start button
        const startBtn = document.getElementById('startGame');
        if (startBtn && !this.gameStarted) {
            const playerCount = data.players.length;
            startBtn.disabled = playerCount < 2;
            startBtn.innerHTML = `<i class="fas fa-play"></i> Mulai Game (${playerCount}/10 Pemain)`;
        }
        
        // Update vote dropdown
        this.updateVoteDropdown(data.players);
    }
    
    handleError(data) {
        console.error('Server error:', data);
        this.showNotification(data.message || 'Terjadi kesalahan', 'error');
    }
    
    handleGameStarted(data) {
        console.log('Game started:', data);
        this.gameStarted = true;
        this.room = data;
        this.showGameScreen();
        
        // Reset vote status
        this.voted = false;
        const voteBtn = document.getElementById('submitVote');
        if (voteBtn) {
            voteBtn.disabled = false;
        }
    }
    
    handleRoleAssigned(data) {
        console.log('Role assigned:', data);
        this.showRoleModal(data.role, data.objective);
        
        // Update player info UI
        if (document.getElementById('playerRole')) {
            document.getElementById('playerRole').textContent = data.role;
            document.getElementById('playerRole').className = 'role-revealed';
        }
        
        if (document.getElementById('playerObjective')) {
            document.getElementById('playerObjective').textContent = data.objective;
        }
        
        if (document.getElementById('secretButtons')) {
            document.getElementById('secretButtons').textContent = data.secretUses || 3;
        }
        
        if (document.getElementById('remainingUses')) {
            document.getElementById('remainingUses').textContent = data.secretUses || 3;
        }
    }
    
    handleGameUpdate(data) {
        this.updateGameUI(data);
    }
    
    handleSecretButtonUsed(data) {
        console.log('Secret button used:', data);
        this.showNotification(`${data.player} ${data.message}`, 'warning');
        
        // Update remaining uses for current player
        if (data.player === this.player?.username) {
            this.updateRemainingUses(data.remainingUses);
        }
    }
    
    handleSystemRepaired(data) {
        console.log('System repaired:', data);
        const message = `${data.repairedBy} memperbaiki ${data.system} ke ${data.newHealth}%`;
        this.showNotification(message, 'info');
        
        // Add to event log
        this.addEventLog(message, 'info');
    }
    
    handleRandomEvent(data) {
        console.log('Random event:', data);
        if (data.message && !data.displayed) {
            this.addEventLog(data.message, 'warning');
            this.showNotification(`EVENT: ${data.message}`, 'warning');
            data.displayed = true;
        }
    }
    
    handleVoteCasted(data) {
        console.log('Vote casted:', data);
        this.updateVoteStatus(`${data.votes}/${data.totalPlayers} pemain sudah voting`);
        
        if (data.voter === this.player?.username) {
            this.voted = true;
            const voteBtn = document.getElementById('submitVote');
            if (voteBtn) {
                voteBtn.disabled = true;
                voteBtn.textContent = 'Sudah Voting';
            }
        }
    }
    
    handlePlayerEjected(data) {
        console.log('Player ejected:', data);
        const message = `${data.player} dikeluarkan dengan ${data.votes} votes!`;
        this.showNotification(message, 'warning');
        this.addEventLog(message, 'danger');
    }
    
    handleVoteReset() {
        console.log('Vote reset');
        this.voted = false;
        const voteBtn = document.getElementById('submitVote');
        if (voteBtn) {
            voteBtn.disabled = false;
            voteBtn.innerHTML = '<i class="fas fa-check-circle"></i> Submit Vote';
        }
        this.updateVoteStatus('Voting dimulai ulang');
    }
    
    handleGameEnded(data) {
        console.log('Game ended:', data);
        this.gameStarted = false;
        this.showGameOverModal(data.message, data.winners, data.stats);
    }
    
    handleRoomReset(data) {
        console.log('Room reset:', data);
        this.showNotification(data.message, 'info');
        this.gameStarted = false;
        
        // Reset UI elements
        const startBtn = document.getElementById('startGame');
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fas fa-play"></i> Mulai Game Baru';
        }
    }
    
    handleChatMessage(data) {
        console.log('Chat message:', data);
        this.addChatMessage(data.sender, data.message, data.timestamp, data.role, data.type);
    }
    
    handleEjected(data) {
        console.log('Ejected:', data);
        alert(`Anda dikeluarkan dari game: ${data.reason}`);
        window.location.href = '/';
    }
    
    // UI Methods
    showRoomScreen(roomId) {
        // Update room code displays
        const roomCodeElements = [
            'roomCodeDisplay',
            'displayRoomCode', 
            'currentRoomCode'
        ];
        
        roomCodeElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = roomId;
            }
        });
        
        // Show room info section
        const roomInfo = document.getElementById('roomInfo');
        if (roomInfo) {
            roomInfo.classList.remove('hidden');
        }
        
        // Redirect to game page if not already there
        if (!window.location.pathname.includes('game.html')) {
            setTimeout(() => {
                window.location.href = `/game?room=${roomId}`;
            }, 1000);
        }
    }
    
    showGameScreen() {
        // Hide role modal if visible
        const roleModal = document.getElementById('roleModal');
        if (roleModal) {
            roleModal.classList.add('hidden');
        }
        
        // Setup game UI elements
        this.setupRepairButtons();
        this.setupSecretButtons();
        
        // Show game over modal jika ada dari sebelumnya
        const gameOverModal = document.getElementById('gameOverModal');
        if (gameOverModal) {
            gameOverModal.classList.add('hidden');
        }
        
        // Reset vote status
        this.voted = false;
        const voteBtn = document.getElementById('submitVote');
        if (voteBtn) {
            voteBtn.disabled = false;
            voteBtn.innerHTML = '<i class="fas fa-check-circle"></i> Submit Vote';
        }
        
        this.updateVoteStatus('Menunggu voting dimulai...');
    }
    
    showRoleModal(role, objective) {
        const modal = document.getElementById('roleModal');
        const roleElement = document.getElementById('revealedRole');
        const objectiveElement = document.getElementById('revealedObjective');
        
        if (modal && roleElement && objectiveElement) {
            roleElement.textContent = role;
            objectiveElement.textContent = objective;
            modal.classList.remove('hidden');
        }
    }
    
    updateGameUI(data) {
        // Update ship health
        this.updateElementText('shipHealth', `${data.shipHealth}%`);
        this.updateElementText('finalHealth', data.shipHealth);
        
        // Update distance
        const distance = Math.floor(data.distance);
        this.updateElementText('distance', distance);
        this.updateElementText('finalDistance', distance);
        
        // Update progress
        const progressPercent = data.progress || (data.distance / data.totalDistance * 100).toFixed(1);
        this.updateElementText('progressPercent', progressPercent);
        
        const progressFill = document.getElementById('progressFill');
        if (progressFill) {
            progressFill.style.width = `${progressPercent}%`;
        }
        
        // Update ship position
        const shipPosition = document.getElementById('shipPosition');
        if (shipPosition) {
            shipPosition.style.left = `${progressPercent}%`;
        }
        
        // Update time
        const minutes = Math.floor(data.timeLeft / 60);
        const seconds = data.timeLeft % 60;
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        this.updateElementText('timeLeft', timeStr);
        this.updateElementText('finalTime', timeStr);
        
        // Update systems
        if (data.systems) {
            this.updateSystemsDisplay(data.systems);
        }
        
        // Update events log
        if (data.events && Array.isArray(data.events)) {
            data.events.forEach(event => {
                if (event.message && !event.logged) {
                    this.addEventLog(event.message, event.type || 'info');
                    event.logged = true;
                }
            });
        }
    }
    
    updateSystemsDisplay(systems) {
        const systemsList = document.getElementById('systemsList');
        if (!systemsList) return;
        
        systemsList.innerHTML = '';
        
        Object.entries(systems).forEach(([name, health]) => {
            const systemEl = document.createElement('div');
            systemEl.className = 'system-item';
            systemEl.innerHTML = `
                <span>${name}</span>
                <div class="system-health">
                    <span>${Math.round(health)}%</span>
                    <div class="health-bar">
                        <div class="health-fill" style="width: ${health}%"></div>
                    </div>
                </div>
            `;
            systemsList.appendChild(systemEl);
        });
    }
    
    updatePlayerList(players) {
        // Update lobby player list
        const playerList = document.getElementById('playerList');
        if (playerList) {
            playerList.innerHTML = '';
            players.forEach(player => {
                const li = document.createElement('li');
                li.textContent = `${player.username} ${player.connected ? '✅' : '❌'}`;
                playerList.appendChild(li);
            });
        }
        
        // Update game player list
        const playersContainer = document.getElementById('playersContainer');
        if (playersContainer) {
            playersContainer.innerHTML = '';
            players.forEach(player => {
                const playerCard = document.createElement('div');
                playerCard.className = 'player-card';
                playerCard.dataset.playerId = player.id;
                playerCard.innerHTML = `
                    <div class="player-icon">${this.getRoleIcon(player.role)}</div>
                    <div class="player-name">
                        ${player.username}
                        ${player.connected ? '' : '<small class="disconnected">(OFF)</small>'}
                    </div>
                    <div class="player-role">${player.role || '???'}</div>
                `;
                playersContainer.appendChild(playerCard);
            });
        }
    }
    
    updatePlayerCount(count) {
        const elements = ['playerCount', 'totalPlayers'];
        elements.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = count;
            }
        });
    }
    
    updateVoteDropdown(players) {
        const select = document.getElementById('voteSelect');
        if (!select) return;
        
        // Save current selection
        const currentValue = select.value;
        
        // Clear and repopulate
        select.innerHTML = '<option value="">Pilih pemain yang dicurigai</option>';
        
        // Filter out current player and disconnected players
        const otherPlayers = players.filter(p => 
            p.id !== this.socket.id && p.connected
        );
        
        otherPlayers.forEach(player => {
            const option = document.createElement('option');
            option.value = player.id;
            option.textContent = `${player.username} (${player.role || '???'})`;
            select.appendChild(option);
        });
        
        // Restore selection if still valid
        if (currentValue && otherPlayers.some(p => p.id === currentValue)) {
            select.value = currentValue;
        }
    }
    
    updateVoteStatus(message) {
        const voteStatus = document.getElementById('voteStatus');
        if (voteStatus) {
            voteStatus.textContent = message;
        }
    }
    
    updateRemainingUses(uses) {
        const elements = ['secretButtons', 'remainingUses'];
        elements.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = uses;
            }
        });
        
        // Disable action buttons if no uses left
        const actionButtons = document.querySelectorAll('.action-btn');
        actionButtons.forEach(btn => {
            btn.disabled = uses <= 0;
        });
    }
    
    updateElementText(id, text) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = text;
        }
    }
    
    // UI Setup Methods
    setupRepairButtons() {
        const repairButtons = document.querySelector('.repair-buttons');
        if (!repairButtons) return;
        
        const systems = ['Engine', 'Oxygen', 'Navigation', 'Shield', 'Communication'];
        repairButtons.innerHTML = '';
        
        systems.forEach(system => {
            const button = document.createElement('button');
            button.className = 'repair-btn';
            button.dataset.system = system;
            button.innerHTML = `
                <i class="fas fa-${this.getSystemIcon(system)}"></i>
                <span>${system}</span>
                <small>Perbaiki</small>
            `;
            
            button.addEventListener('click', () => {
                if (this.gameStarted) {
                    this.socket.emit('repairSystem', system);
                }
            });
            
            repairButtons.appendChild(button);
        });
    }
    
    setupSecretButtons() {
        const actionButtons = document.querySelectorAll('.action-btn');
        actionButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (!this.gameStarted) {
                    this.showNotification('Game belum dimulai!', 'error');
                    return;
                }
                
                const action = e.currentTarget.dataset.action;
                this.socket.emit('useSecretButton', { action });
            });
        });
    }
    
    // Helper Methods
    getRoleIcon(role) {
        const icons = {
            'Captain': '👨‍✈️',
            'Technician': '🔧',
            'Spy': '🕵️',
            'AI': '🤖',
            'Saboteur': '😈',
            null: '👤'
        };
        return icons[role] || '👤';
    }
    
    getSystemIcon(system) {
        const icons = {
            'Engine': 'rocket',
            'Oxygen': 'wind',
            'Navigation': 'compass',
            'Shield': 'shield-alt',
            'Communication': 'satellite'
        };
        return icons[system] || 'cog';
    }
    
    addEventLog(message, type = 'info') {
        const eventsList = document.getElementById('eventsList');
        if (!eventsList) return;
        
        const icon = type === 'danger' ? 'exclamation-circle' : 
                    type === 'warning' ? 'exclamation-triangle' : 'info-circle';
        
        const eventEl = document.createElement('div');
        eventEl.className = `event-item ${type}`;
        eventEl.innerHTML = `
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
        `;
        
        eventsList.appendChild(eventEl);
        
        // Keep only last 10 events
        const events = eventsList.querySelectorAll('.event-item');
        if (events.length > 10) {
            events[0].remove();
        }
        
        // Auto-scroll
        eventsList.scrollTop = eventsList.scrollHeight;
    }
    
    addChatMessage(sender, message, timestamp, role = null, type = 'chat') {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        
        const time = new Date(timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        
        let roleBadge = '';
        if (role && type === 'chat') {
            roleBadge = `<span class="role-badge">${role}</span>`;
        }
        
        messageEl.innerHTML = `
            <div class="message-header">
                <span class="sender">${sender}</span>
                ${roleBadge}
                <span class="time">${time}</span>
            </div>
            <div class="message-text">${this.escapeHtml(message)}</div>
        `;
        
        chatMessages.appendChild(messageEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // Keep only last 50 messages
        const messages = chatMessages.querySelectorAll('.message');
        if (messages.length > 50) {
            messages[0].remove();
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showGameOverModal(message, winners, stats) {
        const modal = document.getElementById('gameOverModal');
        const title = document.getElementById('gameOverTitle');
        const winnersList = document.getElementById('winnersList');
        
        if (!modal || !title || !winnersList) return;
        
        title.textContent = message;
        
        // Update stats
        if (stats) {
            this.updateElementText('finalHealth', Math.round(stats.shipHealth));
            this.updateElementText('finalDistance', Math.round(stats.distance));
            
            const minutes = Math.floor(stats.timeLeft / 60);
            const seconds = stats.timeLeft % 60;
            const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            this.updateElementText('finalTime', timeStr);
        }
        
        // Update winners list
        winnersList.innerHTML = '';
        if (winners && winners.length > 0) {
            winners.forEach(winner => {
                const li = document.createElement('li');
                li.textContent = winner;
                winnersList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.textContent = 'Tidak ada pemenang';
            li.style.opacity = '0.7';
            winnersList.appendChild(li);
        }
        
        modal.classList.remove('hidden');
    }
    
    showNotification(message, type = 'info') {
        // Create notification element if it doesn't exist
        let notification = document.getElementById('notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.className = 'notification hidden';
            document.body.appendChild(notification);
        }
        
        // Set content and style
        notification.textContent = message;
        notification.className = `notification ${type} show`;
        
        // Set color based on type
        const colors = {
            'success': '#00ff88',
            'error': '#ff0080',
            'warning': '#ff8c00',
            'info': '#00d4ff'
        };
        
        notification.style.borderLeftColor = colors[type] || '#00d4ff';
        
        // Auto-hide
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.classList.add('hidden');
            }, 300);
        }, 3000);
    }
    
    bindEvents() {
        // Lobby events
        const createBtn = document.getElementById('createRoom');
        if (createBtn) {
            createBtn.addEventListener('click', () => {
                const username = document.getElementById('username').value.trim() || 'Player';
                this.socket.emit('createRoom', { username });
            });
        }
        
        const joinBtn = document.getElementById('joinRoom');
        if (joinBtn) {
            joinBtn.addEventListener('click', () => {
                const username = document.getElementById('username').value.trim() || 'Player';
                const roomCode = document.getElementById('roomCode').value.toUpperCase().trim();
                
                if (roomCode.length === 5) {
                    this.socket.emit('joinRoom', { roomId: roomCode, username });
                } else {
                    this.showNotification('Kode room harus 5 karakter!', 'error');
                }
            });
        }
        
        const startBtn = document.getElementById('startGame');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                this.socket.emit('startGame');
            });
        }
        
        const copyBtn = document.getElementById('copyCode');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const code = document.getElementById('displayRoomCode').textContent;
                navigator.clipboard.writeText(code).then(() => {
                    this.showNotification('Kode room disalin!', 'success');
                });
            });
        }
        
        // Game events
        const chatInput = document.getElementById('chatInput');
        const sendChat = document.getElementById('sendChat');
        
        if (chatInput && sendChat) {
            const sendMessage = () => {
                const message = chatInput.value.trim();
                if (message) {
                    this.socket.emit('sendChat', message);
                    chatInput.value = '';
                }
            };
            
            sendChat.addEventListener('click', sendMessage);
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    sendMessage();
                }
            });
        }
        
        const submitVote = document.getElementById('submitVote');
        if (submitVote) {
            submitVote.addEventListener('click', () => {
                const select = document.getElementById('voteSelect');
                const targetId = select.value;
                
                if (targetId && !this.voted && this.gameStarted) {
                    this.socket.emit('castVote', { targetPlayerId: targetId });
                }
            });
        }
        
        // Modal events
        const closeModal = document.getElementById('closeModal');
        if (closeModal) {
            closeModal.addEventListener('click', () => {
                document.getElementById('roleModal').classList.add('hidden');
            });
        }
        
        const playAgain = document.getElementById('playAgain');
        if (playAgain) {
            playAgain.addEventListener('click', () => {
                window.location.reload();
            });
        }
        
        const backToLobby = document.getElementById('backToLobby');
        if (backToLobby) {
            backToLobby.addEventListener('click', () => {
                window.location.href = '/';
            });
        }
        
        // Handle Enter key in room code field
        const roomCodeInput = document.getElementById('roomCode');
        if (roomCodeInput) {
            roomCodeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    joinBtn?.click();
                }
            });
        }
    }
    
    checkURLParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        
        if (roomCode && document.getElementById('roomCode')) {
            document.getElementById('roomCode').value = roomCode;
            
            // Auto-join if on game page with room code
            if (window.location.pathname.includes('game.html')) {
                const username = localStorage.getItem('chaos_username') || 'Player';
                setTimeout(() => {
                    this.socket.emit('joinRoom', { 
                        roomId: roomCode, 
                        username: username 
                    });
                }, 1000);
            }
        }
        
        // Save username to localStorage
        const usernameInput = document.getElementById('username');
        if (usernameInput) {
            const savedUsername = localStorage.getItem('chaos_username');
            if (savedUsername) {
                usernameInput.value = savedUsername;
            }
            
            usernameInput.addEventListener('change', () => {
                localStorage.setItem('chaos_username', usernameInput.value);
            });
        }
    }
}

// Initialize game when page loads
window.addEventListener('DOMContentLoaded', () => {
    // Add connection status indicator
    if (!document.getElementById('connectionStatus')) {
        const statusDiv = document.createElement('div');
        statusDiv.id = 'connectionStatus';
        statusDiv.className = 'status-connected';
        statusDiv.textContent = 'Menyambung...';
        statusDiv.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            padding: 5px 10px;
            border-radius: 15px;
            font-size: 12px;
            z-index: 1000;
            background: #00ff88;
            color: #000;
            font-weight: bold;
        `;
        document.body.appendChild(statusDiv);
    }
    
    window.game = new ChaosGame();
});

// Add CSS for connection status
const style = document.createElement('style');
style.textContent = `
    .status-connected {
        background: #00ff88 !important;
        color: #000 !important;
    }
    .status-disconnected {
        background: #ff0080 !important;
        color: white !important;
    }
    .role-revealed {
        color: #ff0080 !important;
        font-weight: bold !important;
    }
    .role-badge {
        background: rgba(0, 212, 255, 0.2);
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.8em;
        margin-left: 5px;
    }
    .disconnected {
        color: #ff0080;
        font-style: italic;
    }
    .notification.show {
        animation: slideIn 0.3s ease-out;
    }
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
`;
document.head.appendChild(style);