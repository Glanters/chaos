import { Server } from 'socket.io';
import { createServer } from 'http';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Middleware untuk parsing JSON
app.use(express.json());

// Serve static files
app.use(express.static(join(__dirname, '../public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

app.get('/game', (req, res) => {
  res.sendFile(join(__dirname, '../public/game.html'));
});

// Health check endpoint untuk Vercel
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    players: Object.keys(players).length,
    rooms: Object.keys(rooms).length
  });
});

const httpServer = createServer(app);

// Konfigurasi Socket.io untuk Vercel
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  cookie: false
});

// In-memory storage (gunakan Redis untuk production)
const rooms = {};
const players = {};
const gameIntervals = {};

const ROLES = ['Captain', 'Technician', 'Spy', 'AI', 'Saboteur'];
const SHIP_SYSTEMS = ['Engine', 'Oxygen', 'Navigation', 'Shield', 'Communication'];

// Fungsi helper
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function assignRoles(playerCount) {
  const assigned = ['Captain', 'Technician'];
  
  if (playerCount >= 3) assigned.push('Spy');
  if (playerCount >= 4) assigned.push('AI');
  if (playerCount >= 5) assigned.push('Saboteur');
  
  while (assigned.length < playerCount) {
    const randomRole = ROLES[Math.floor(Math.random() * ROLES.length)];
    if (!assigned.includes(randomRole)) {
      assigned.push(randomRole);
    }
  }
  
  return assigned.sort(() => Math.random() - 0.5);
}

function getObjective(role) {
  const objectives = {
    'Captain': 'Bawa kapal sampai tujuan dengan sistem ≥60%',
    'Technician': 'Jaga semua sistem di atas 70%',
    'Spy': 'Kumpulkan 3 data rahasia tanpa ketahuan',
    'AI': 'Ikuti semua perintah Captain tapi jaga sistem oksigen <50%',
    'Saboteur': 'Cegah kapal sampai tujuan tanpa ketahuan'
  };
  return objectives[role] || 'Selesaikan misi rahasiamu!';
}

function getRandomEvent() {
  const events = [
    { 
      type: 'meteor', 
      message: '⚠️ Serangan meteor! Sistem rusak.',
      effect: { system: 'random', damage: 25 }
    },
    { 
      type: 'radiation', 
      message: '☢️ Gelombang radiasi! Perbaiki shield.',
      effect: { system: 'Shield', damage: 15 }
    },
    { 
      type: 'alien', 
      message: '👽 Sinyal alien terdeteksi.',
      effect: null
    },
    { 
      type: 'system_failure', 
      message: '🔧 Kegagalan sistem! Periksa semua panel.',
      effect: { system: 'random', damage: 10 }
    }
  ];
  return events[Math.floor(Math.random() * events.length)];
}

function calculateShipHealth(systems) {
  const values = Object.values(systems);
  if (values.length === 0) return 100;
  const total = values.reduce((sum, health) => sum + health, 0);
  return Math.floor(total / values.length);
}

// Socket.io event handlers
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  
  // Send connection confirmation
  socket.emit('connected', { 
    socketId: socket.id,
    timestamp: new Date().toISOString()
  });
  
  socket.on('createRoom', ({ username }) => {
    try {
      const roomId = generateRoomId();
      const playerName = username?.trim() || `Player_${socket.id.substring(0, 4)}`;
      
      // Initialize room
      rooms[roomId] = {
        id: roomId,
        players: [],
        gameStarted: false,
        shipHealth: 100,
        systems: SHIP_SYSTEMS.reduce((acc, system) => {
          acc[system] = 100;
          return acc;
        }, {}),
        distance: 0,
        totalDistance: 100,
        timeLeft: 15 * 60,
        events: [],
        votes: {},
        startTime: null
      };
      
      // Create player
      players[socket.id] = {
        id: socket.id,
        username: playerName,
        roomId,
        role: null,
        secretButtonUses: 3,
        voted: false,
        objectiveCompleted: false,
        connected: true
      };
      
      // Add player to room
      rooms[roomId].players.push(socket.id);
      socket.join(roomId);
      
      console.log(`Room ${roomId} created by ${playerName}`);
      
      // Send responses
      socket.emit('roomCreated', { 
        roomId, 
        player: playerName,
        room: rooms[roomId]
      });
      
      // Update all players in room
      updateRoomPlayers(roomId);
      
      // Send welcome message
      io.to(roomId).emit('chatMessage', {
        sender: 'System',
        message: `🚀 Room ${roomId} berhasil dibuat!`,
        timestamp: new Date().toISOString(),
        type: 'system'
      });
      
    } catch (error) {
      console.error('Error creating room:', error);
      socket.emit('error', { message: 'Gagal membuat room' });
    }
  });
  
  socket.on('joinRoom', ({ roomId, username }) => {
    try {
      const room = rooms[roomId];
      const playerName = username?.trim() || `Player_${socket.id.substring(0, 4)}`;
      
      if (!room) {
        socket.emit('error', { message: 'Room tidak ditemukan' });
        return;
      }
      
      if (room.gameStarted) {
        socket.emit('error', { message: 'Game sudah dimulai' });
        return;
      }
      
      if (room.players.length >= 10) {
        socket.emit('error', { message: 'Room penuh (max 10 pemain)' });
        return;
      }
      
      // Check if username already exists in room
      const existingPlayer = room.players.find(pId => 
        players[pId]?.username === playerName
      );
      
      if (existingPlayer) {
        socket.emit('error', { message: 'Username sudah digunakan di room ini' });
        return;
      }
      
      // Create player
      players[socket.id] = {
        id: socket.id,
        username: playerName,
        roomId,
        role: null,
        secretButtonUses: 3,
        voted: false,
        objectiveCompleted: false,
        connected: true
      };
      
      // Add player to room
      room.players.push(socket.id);
      socket.join(roomId);
      
      console.log(`${playerName} joined room ${roomId}`);
      
      // Send responses
      socket.emit('joinedRoom', { 
        roomId, 
        player: playerName,
        room: room
      });
      
      // Update all players in room
      updateRoomPlayers(roomId);
      
      // Announce to room
      io.to(roomId).emit('chatMessage', {
        sender: 'System',
        message: `👋 ${playerName} bergabung ke game!`,
        timestamp: new Date().toISOString(),
        type: 'system'
      });
      
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Gagal bergabung ke room' });
    }
  });
  
  socket.on('startGame', () => {
    try {
      const player = players[socket.id];
      if (!player) return;
      
      const room = rooms[player.roomId];
      if (!room || room.gameStarted) return;
      
      // Minimum 2 players
      if (room.players.length < 2) {
        socket.emit('error', { message: 'Minimal 2 pemain untuk memulai game' });
        return;
      }
      
      // Assign roles
      const roles = assignRoles(room.players.length);
      room.players.forEach((playerId, index) => {
        if (players[playerId]) {
          players[playerId].role = roles[index];
          players[playerId].objective = getObjective(roles[index]);
          
          // Send role privately
          io.to(playerId).emit('roleAssigned', {
            role: roles[index],
            objective: players[playerId].objective,
            secretUses: 3
          });
        }
      });
      
      // Initialize game state
      room.gameStarted = true;
      room.startTime = Date.now();
      room.events = [];
      room.votes = {};
      
      // Reset all players' voted status
      room.players.forEach(playerId => {
        if (players[playerId]) {
          players[playerId].voted = false;
        }
      });
      
      // Start game loop
      startGameLoop(room.id);
      
      console.log(`Game started in room ${room.id}`);
      
      // Announce game start
      io.to(room.id).emit('gameStarted', {
        ...room,
        players: room.players.map(id => ({
          id,
          username: players[id]?.username,
          role: players[id]?.role
        }))
      });
      
      io.to(room.id).emit('chatMessage', {
        sender: 'System',
        message: '🎮 GAME DIMULAI! Peran rahasia telah dibagikan.',
        timestamp: new Date().toISOString(),
        type: 'system'
      });
      
    } catch (error) {
      console.error('Error starting game:', error);
      socket.emit('error', { message: 'Gagal memulai game' });
    }
  });
  
  socket.on('useSecretButton', ({ action }) => {
    try {
      const player = players[socket.id];
      if (!player) return;
      
      const room = rooms[player.roomId];
      if (!room || !room.gameStarted) return;
      
      if (player.secretButtonUses <= 0) {
        socket.emit('error', { message: 'Tombol rahasia sudah habis!' });
        return;
      }
      
      player.secretButtonUses--;
      
      const actions = {
        lights: { 
          message: '💡 Lampu mati selama 30 detik!',
          effect: () => {
            room.events.push({
              type: 'lights_out',
              duration: 30,
              timestamp: Date.now()
            });
          }
        },
        engine: { 
          message: '🚀 Mesin terganggu! Kecepatan berkurang.',
          effect: () => {
            room.systems.Engine = Math.max(0, room.systems.Engine - 20);
          }
        },
        door: { 
          message: '🚪 Pintu darurat terbuka! Sistem oksigen terganggu.',
          effect: () => {
            room.systems.Oxygen = Math.max(0, room.systems.Oxygen - 15);
          }
        },
        hack: { 
          message: '💻 Sistem navigasi di-hack!',
          effect: () => {
            room.systems.Navigation = Math.max(0, room.systems.Navigation - 25);
          }
        }
      };
      
      const selectedAction = actions[action] || actions.lights;
      selectedAction.effect();
      
      // Add to events log
      room.events.push({
        type: 'secret_action',
        player: player.username,
        action: action,
        timestamp: Date.now(),
        message: `${player.username} menggunakan tombol rahasia: ${selectedAction.message}`
      });
      
      // Notify all players
      io.to(room.id).emit('secretButtonUsed', {
        player: player.username,
        action: action,
        message: selectedAction.message,
        remainingUses: player.secretButtonUses
      });
      
      io.to(room.id).emit('chatMessage', {
        sender: 'System',
        message: `⚡ ${player.username} menggunakan tombol rahasia! ${selectedAction.message}`,
        timestamp: new Date().toISOString(),
        type: 'warning'
      });
      
    } catch (error) {
      console.error('Error using secret button:', error);
      socket.emit('error', { message: 'Gagal menggunakan tombol rahasia' });
    }
  });
  
  socket.on('repairSystem', (system) => {
    try {
      const player = players[socket.id];
      if (!player) return;
      
      const room = rooms[player.roomId];
      if (!room || !room.gameStarted) return;
      
      if (!SHIP_SYSTEMS.includes(system)) {
        socket.emit('error', { message: 'Sistem tidak valid' });
        return;
      }
      
      // Technician repairs more effectively
      const repairAmount = player.role === 'Technician' ? 35 : 15;
      room.systems[system] = Math.min(100, room.systems[system] + repairAmount);
      
      // Add to events log
      room.events.push({
        type: 'repair',
        player: player.username,
        system: system,
        amount: repairAmount,
        timestamp: Date.now(),
        message: `${player.username} memperbaiki ${system} sebesar ${repairAmount}%`
      });
      
      // Notify all players
      io.to(room.id).emit('systemRepaired', {
        system: system,
        newHealth: room.systems[system],
        repairedBy: player.username,
        isTechnician: player.role === 'Technician'
      });
      
      io.to(room.id).emit('chatMessage', {
        sender: 'System',
        message: `🔧 ${player.username} memperbaiki sistem ${system} ke ${room.systems[system]}%`,
        timestamp: new Date().toISOString(),
        type: 'info'
      });
      
    } catch (error) {
      console.error('Error repairing system:', error);
      socket.emit('error', { message: 'Gagal memperbaiki sistem' });
    }
  });
  
  socket.on('castVote', ({ targetPlayerId }) => {
    try {
      const player = players[socket.id];
      if (!player || player.voted) return;
      
      const room = rooms[player.roomId];
      if (!room || !room.gameStarted) return;
      
      const targetPlayer = players[targetPlayerId];
      if (!targetPlayer || targetPlayer.roomId !== room.id) {
        socket.emit('error', { message: 'Pemain target tidak valid' });
        return;
      }
      
      player.voted = true;
      room.votes[player.id] = targetPlayerId;
      
      // Check if voting is complete
      const votedCount = room.players.filter(id => players[id]?.voted).length;
      const totalPlayers = room.players.length;
      
      io.to(room.id).emit('voteCasted', {
        voter: player.username,
        target: targetPlayer.username,
        votes: votedCount,
        totalPlayers: totalPlayers
      });
      
      io.to(room.id).emit('chatMessage', {
        sender: 'System',
        message: `🗳️ ${player.username} memilih untuk mengeluarkan ${targetPlayer.username}`,
        timestamp: new Date().toISOString(),
        type: 'info'
      });
      
      // If all players voted, process votes
      if (votedCount === totalPlayers) {
        processVotes(room.id);
      }
      
    } catch (error) {
      console.error('Error casting vote:', error);
      socket.emit('error', { message: 'Gagal melakukan voting' });
    }
  });
  
  socket.on('sendChat', (message) => {
    try {
      const player = players[socket.id];
      if (!player) return;
      
      const room = rooms[player.roomId];
      if (!room) return;
      
      const cleanMessage = message.toString().trim().substring(0, 200);
      if (!cleanMessage) return;
      
      io.to(room.id).emit('chatMessage', {
        sender: player.username,
        message: cleanMessage,
        timestamp: new Date().toISOString(),
        role: player.role,
        type: 'chat'
      });
      
    } catch (error) {
      console.error('Error sending chat:', error);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    
    const player = players[socket.id];
    if (player) {
      const room = rooms[player.roomId];
      if (room) {
        // Mark player as disconnected
        player.connected = false;
        
        // Remove player from room if game hasn't started
        if (!room.gameStarted) {
          room.players = room.players.filter(id => id !== socket.id);
          
          if (room.players.length === 0) {
            // Clean up empty room
            delete rooms[room.id];
            if (gameIntervals[room.id]) {
              clearInterval(gameIntervals[room.id]);
              delete gameIntervals[room.id];
            }
          }
          
          // Update remaining players
          updateRoomPlayers(room.id);
          
          io.to(room.id).emit('chatMessage', {
            sender: 'System',
            message: `👋 ${player.username} meninggalkan room`,
            timestamp: new Date().toISOString(),
            type: 'system'
          });
        } else {
          // If game is started, just mark as disconnected
          io.to(room.id).emit('chatMessage', {
            sender: 'System',
            message: `⚠️ ${player.username} terputus dari game`,
            timestamp: new Date().toISOString(),
            type: 'warning'
          });
          
          // Check if too few players remain
          const activePlayers = room.players.filter(id => players[id]?.connected);
          if (activePlayers.length < 2) {
            endGame(room.id, 'Game berakhir: Terlalu sedikit pemain yang tersisa');
          }
        }
      }
      
      // Clean up player data after a delay
      setTimeout(() => {
        if (!players[socket.id]?.connected) {
          delete players[socket.id];
        }
      }, 30000);
    }
  });
  
  socket.on('ping', () => {
    socket.emit('pong');
  });
});

// Helper functions
function updateRoomPlayers(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  
  const playerData = room.players.map(id => ({
    id,
    username: players[id]?.username || 'Unknown',
    role: players[id]?.role,
    connected: players[id]?.connected
  }));
  
  io.to(roomId).emit('roomUpdated', {
    players: playerData,
    roomId: roomId,
    gameStarted: room.gameStarted,
    playerCount: room.players.length
  });
}

function startGameLoop(roomId) {
  if (gameIntervals[roomId]) {
    clearInterval(gameIntervals[roomId]);
  }
  
  gameIntervals[roomId] = setInterval(() => {
    updateGame(roomId);
  }, 1000);
}

function updateGame(roomId) {
  const room = rooms[roomId];
  if (!room || !room.gameStarted) return;
  
  // Update time
  room.timeLeft--;
  
  // Update distance based on engine health
  const engineEfficiency = room.systems.Engine / 100;
  room.distance += engineEfficiency * 0.5;
  
  // Random system degradation (2% chance per second)
  SHIP_SYSTEMS.forEach(system => {
    if (Math.random() < 0.02) {
      room.systems[system] = Math.max(0, room.systems[system] - 2);
    }
  });
  
  // Random events (3% chance per second)
  if (Math.random() < 0.03) {
    const event = getRandomEvent();
    const eventData = {
      ...event,
      timestamp: Date.now(),
      displayed: false
    };
    
    room.events.push(eventData);
    
    // Apply event effects
    if (event.effect) {
      if (event.effect.system === 'random') {
        const randomSystem = SHIP_SYSTEMS[Math.floor(Math.random() * SHIP_SYSTEMS.length)];
        room.systems[randomSystem] = Math.max(0, room.systems[randomSystem] - event.effect.damage);
      } else if (SHIP_SYSTEMS.includes(event.effect.system)) {
        room.systems[event.effect.system] = Math.max(
          0, 
          room.systems[event.effect.system] - event.effect.damage
        );
      }
    }
    
    // Notify players
    io.to(roomId).emit('randomEvent', eventData);
    
    io.to(roomId).emit('chatMessage', {
      sender: 'System',
      message: `🚨 ${event.message}`,
      timestamp: new Date().toISOString(),
      type: 'warning'
    });
  }
  
  // Calculate ship health
  room.shipHealth = calculateShipHealth(room.systems);
  
  // Send game update to all players
  const gameData = {
    timeLeft: room.timeLeft,
    distance: Math.min(room.distance, room.totalDistance),
    totalDistance: room.totalDistance,
    systems: { ...room.systems },
    shipHealth: room.shipHealth,
    events: room.events.slice(-5).map(e => ({ 
      message: e.message || `${e.player} ${e.action}`,
      type: e.type
    })),
    progress: (room.distance / room.totalDistance * 100).toFixed(1)
  };
  
  io.to(roomId).emit('gameUpdate', gameData);
  
  // Check win/lose conditions
  if (room.timeLeft <= 0) {
    endGame(roomId, '⏰ Waktu habis! Kapal tidak sampai tujuan.');
  } else if (room.distance >= room.totalDistance) {
    endGame(roomId, '🎉 KAPAL SAMPAI TUJUAN!');
  } else if (room.shipHealth <= 0) {
    endGame(roomId, '💥 KAPAL HANCUR! Semua sistem gagal.');
  }
}

function processVotes(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  
  // Count votes
  const voteCount = {};
  Object.values(room.votes).forEach(targetId => {
    voteCount[targetId] = (voteCount[targetId] || 0) + 1;
  });
  
  // Find player with most votes
  let maxVotes = 0;
  let ejectedPlayerId = null;
  
  Object.entries(voteCount).forEach(([playerId, votes]) => {
    if (votes > maxVotes) {
      maxVotes = votes;
      ejectedPlayerId = playerId;
    }
  });
  
  // Reset voting state
  room.votes = {};
  room.players.forEach(playerId => {
    if (players[playerId]) {
      players[playerId].voted = false;
    }
  });
  
  // Eject player if they have majority votes (more than 1)
  if (ejectedPlayerId && maxVotes > 1) {
    const ejectedPlayer = players[ejectedPlayerId];
    
    if (ejectedPlayer) {
      // Remove from room
      room.players = room.players.filter(id => id !== ejectedPlayerId);
      
      // Notify room
      io.to(roomId).emit('playerEjected', {
        player: ejectedPlayer.username,
        votes: maxVotes,
        reason: 'Dikeluarkan oleh voting kru'
      });
      
      io.to(roomId).emit('chatMessage', {
        sender: 'System',
        message: `👢 ${ejectedPlayer.username} dikeluarkan dari kapal dengan ${maxVotes} votes!`,
        timestamp: new Date().toISOString(),
        type: 'warning'
      });
      
      // Disconnect ejected player
      const ejectedSocket = io.sockets.sockets.get(ejectedPlayerId);
      if (ejectedSocket) {
        ejectedSocket.emit('ejected', { 
          reason: 'Anda dikeluarkan oleh voting kru' 
        });
        ejectedSocket.disconnect();
      }
      
      // Clean up player data
      delete players[ejectedPlayerId];
      
      // Check if game should continue
      if (room.players.length < 2) {
        endGame(roomId, 'Game berakhir: Terlalu sedikit pemain setelah voting');
      }
    }
  }
  
  // Reset vote status for all players
  io.to(roomId).emit('voteReset');
}

function endGame(roomId, message) {
  const room = rooms[roomId];
  if (!room) return;
  
  // Stop game loop
  if (gameIntervals[roomId]) {
    clearInterval(gameIntervals[roomId]);
    delete gameIntervals[roomId];
  }
  
  room.gameStarted = false;
  
  // Calculate winners
  const winners = [];
  const finalStats = {
    shipHealth: room.shipHealth,
    distance: Math.min(room.distance, room.totalDistance),
    totalDistance: room.totalDistance,
    timeLeft: room.timeLeft,
    systems: room.systems
  };
  
  room.players.forEach(playerId => {
    const player = players[playerId];
    if (player) {
      // Simple win condition check (expand based on actual objectives)
      const isWinner = checkWinCondition(player, room);
      if (isWinner) {
        winners.push(player.username);
        player.objectiveCompleted = true;
      }
    }
  });
  
  // Send game over event
  io.to(roomId).emit('gameEnded', {
    message: message,
    winners: winners,
    stats: finalStats,
    roomId: roomId
  });
  
  io.to(roomId).emit('chatMessage', {
    sender: 'System',
    message: `🏁 GAME BERAKHIR! ${message}`,
    timestamp: new Date().toISOString(),
    type: 'system'
  });
  
  // Reset room after delay
  setTimeout(() => {
    if (rooms[roomId]) {
      resetRoom(roomId);
    }
  }, 30000);
}

function checkWinCondition(player, room) {
  // Basic win condition logic - expand based on role objectives
  switch(player.role) {
    case 'Captain':
      return room.distance >= room.totalDistance && room.shipHealth >= 60;
    case 'Technician':
      return Object.values(room.systems).every(h => h >= 70);
    case 'Saboteur':
      return room.distance < room.totalDistance;
    default:
      // For other roles, 50% chance of winning
      return Math.random() > 0.5;
  }
}

function resetRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  
  // Reset room state
  room.gameStarted = false;
  room.shipHealth = 100;
  room.distance = 0;
  room.timeLeft = 15 * 60;
  room.events = [];
  room.votes = {};
  
  // Reset systems
  SHIP_SYSTEMS.forEach(system => {
    room.systems[system] = 100;
  });
  
  // Reset player game state but keep them in room
  room.players.forEach(playerId => {
    const player = players[playerId];
    if (player) {
      player.role = null;
      player.voted = false;
      player.secretButtonUses = 3;
      player.objectiveCompleted = false;
    }
  });
  
  // Notify players room is reset
  io.to(roomId).emit('roomReset', {
    message: 'Room telah direset. Game baru dapat dimulai.',
    room: room
  });
}

// Export untuk Vercel Serverless Functions
export default function handler(req, res) {
  // Ini diperlukan untuk Vercel agar tidak timeout
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ 
    status: 'Socket.io server is running',
    timestamp: new Date().toISOString()
  });
}

// Start server jika tidak di Vercel (development mode)
if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket server ready`);
  });
}