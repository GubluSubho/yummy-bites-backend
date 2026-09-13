require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/menu', require('./routes/menu'));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.log('❌ Connection error:', err));

app.get('/', (req, res) => res.send('API is running'));

app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));