var app = require('http').createServer(handler),
    io = require('socket.io').listen(app),
    fs = require('fs'),
    static = require('node-static');

app.listen(42069);

// Serve static files
var file = new static.Server;
function handler (req, res) {
  req.addListener('end', function () {
    file.serve(req, res);
  });
}

// Some global vars. Probably could be in redis or something
// but who cares
var users = [];
var rooms = [];

function cardStateChanged(room, id) {
  if (!rooms[room]) {
    console.log("Invalid room", room);
    return;
  }

  if (!rooms[room].cards[id]) {
    console.log("Invalid card", id, "in room", room);
    return;
  }

  // build the message to go out to all the clients
  var card = rooms[room].cards[id];
  var infoStr = '';
  infoStr += String.fromCharCode(0);
  infoStr += String.fromCharCode(card.id);
  infoStr += String.fromCharCode(card.x);
  infoStr += String.fromCharCode(card.y);
  infoStr += String.fromCharCode(card.rotation);
  infoStr += String.fromCharCode(card.v); // value
  infoStr += String.fromCharCode(card.s); // suit
  infoStr += String.fromCharCode(card.lock ? 1 : 0);
  io.sockets.in(room).send(infoStr);
}

// Returns true if any registered user is using this name
function isNameInUse(name) {
  for (var i in users) {
    if (name == users[i].name) {
      return true;
    }
  }

    return false;
}

// Returns a user with a given socket.io socketid
function getUser(id) {
  if (!users[id]) {
    console.log('Could not get user', id);
    return;
  }

  return users[id];
}

// Releases a card allowing other players to pick it up again
function setCardLock(room, card, lock) {
  if (!rooms[room]) {
    console.log("Invalid room", room);
    return;
  }

  if (!rooms[room].cards[card]) {
    console.log("Invalid card", card, "in room", room);
    return;
  }
  rooms[room].cards[card].lock = lock;
  // FIXME: send unlocked message
}

// Deletes a registered user (connected to server & has entered a nick/room) with a given socket.io socketid
function deleteUser(id) {
  if (!users[id]) {
    console.log('Could not delete user', socket.id);
  }

  if (users[id].lock) {
    setCardLock(user.room, user.lock, false);
  }

  delete users[id];
}

io.sockets.on('connection', function (socket) {

  // On disconnect, remove the user from our server-wide
  // userlist, and broadcast a message to that channel
  socket.on('disconnect', function(d) {
    var user = getUser(socket.id);
    if (!user) {
      return;
    }

    console.log('Got disconnected user', user.name, socket.id);
    io.sockets.in(user.room).emit('message', user.name +' has left the room');
    deleteUser(socket.id);
  });

  // Echo back what was sent by the player to everyone in their room
  socket.on('chat', function(d) {
    var user = getUser(socket.id);
    if (!user) {
      return;
    }

    io.sockets.in(user.room).emit('chat', {'who': user.name, 'what': d});
  });

  socket.on('move', function(cid, x, y, r) {
    var user = getUser(socket.id);
    if (!user) {
      return;
    }

    if (cid != user.lock) {
      console.log("User", user.name, "tried to move card without a lock");
    }

    if (x) rooms[user.room].cards[cid].x = x;
    if (y) rooms[user.room].cards[cid].y = y;
    if (r) rooms[user.room].cards[cid].rotation = r;

    cardStateChanged(user.room, cid);
  });

  // Locks the card (mousedown) so nobody else can grab it)
  socket.on('lock', function(d) {
    var user = getUser(socket.id);
    if (!user) {
      return;
    }

    // don't allow a user to have 2 locks
    if (user.lock != undefined) {
      setCardLock(user.room, user.lock, false)
      user.lock = undefined;
    }

    //FIXME: don't lock a card locked by another player
    user.lock = d;
    setCardLock(user.room, d, true);
    cardStateChanged(user.room, d);
  })

  // Unlocks the card (mouseup) so nobody else can grab it)
  socket.on('unlock', function(d) {
    var user = getUser(socket.id);
    if (!user) {
      return;
    }

    if (user.lock != undefined) {
      setCardLock(user.room, user.lock, false)
      cardStateChanged(user.room, user.lock);
      user.lock = undefined;
      return;
    }
      console.log("User", user.name, "tried to unlock unowned card", d, "in room", user.room);
  })

  // The actual connection process. The websocket connects but doesn't do much
  // until the client sends their name/room
  socket.on('userinfo', function (d) {
    // FIXME: Do we need to handle when someone renames themselves?
    console.log('Registering a user', d.name);
    if (isNameInUse(d.name)) {
      socket.emit('error', 'Name already in use.');
      console.log('Rejecting', socket.id, 'due to name in use', d.name);
      return;
    }

    // Create a user object for them and store it on our global users object
    var user = {};
    user.name = d.name;
    user.room = d.room;
    user.socket = socket;
    users[socket.id] = user;

    // Join the desired room, send them the current room state (for now
    // just the room name, will eventually be users & cards), alert everyone
    // that they joined
    socket.join(d.room);
    if (!rooms[d.room]) {
      console.log("Creating room", d.room);

      var state = {};
      state.room = d.room;
      state.cards = [];
      // generate a deck of cards
      for (var i = 0; i < 52; i++) {
        state.cards.push( {'id': i, 'x': Math.floor(i/13) * 175, 'y': i%13 * 40, 'rotation': Math.floor(Math.random()*10-5), 'v': i%13, 's': Math.floor(i/13)} );
      }

      rooms[d.room] = state;
    }

    var room = rooms[d.room];
    socket.emit('joined', room);
    socket.emit('info', 'Now in room '+ d.room);
    io.sockets.in(d.room).emit('info', d.name +' has joined the room');

    console.log('User', d.name, 'joined room', d.room);
  });
});
