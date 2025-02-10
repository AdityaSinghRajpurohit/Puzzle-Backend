const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const cron = require("node-cron");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 7000;

app.use(express.json());
app.use(cors({
  origin: "http://localhost:3000",
  methods: ["GET", "POST"],
  credentials: true
}));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ Connected to MongoDB successfully!"))
  .catch(err => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1); // Stop the server if MongoDB fails
  });

const UserSchema = new mongoose.Schema({
  name: String,
  email: String,
  attempts: { type: Number, default: 0 },
  problemsSolved: { type: Number, default: 0 },
  responses: [{ week: Number, answer: String, correct: Boolean }],
});

const LeaderboardSchema = new mongoose.Schema({
  week: Number,
  topPlayers: [{ name: String, problemsSolved: Number, attempts: Number }],
});

const ProblemSchema = new mongoose.Schema({
  week: Number,
  correctAnswer: String
});

const User = mongoose.model("User", UserSchema);
const Leaderboard = mongoose.model("Leaderboard", LeaderboardSchema);
const Problem = mongoose.model("Problem", ProblemSchema);

// API to handle form submission
app.post("/submit", async (req, res) => {
  const { name, email, answer, week } = req.body;

  if (!name || !email || !answer || !week) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  let user = await User.findOne({ email });
  if (!user) {
    user = new User({ name, email, responses: [] });
  }

  const attemptsThisWeek = user.responses.filter(r => r.week === week).length;
  if (attemptsThisWeek >= 3) {
    return res.status(400).json({ message: "Maximum attempts reached for this week" });
  }

  const problem = await Problem.findOne({ week });
  if (!problem) {
    return res.status(500).json({ message: "Problem not found for this week" });
  }

  const isCorrect = answer === problem.correctAnswer;
  user.responses.push({ week, answer, correct: isCorrect });
  user.attempts++;
  if (isCorrect) {
    user.problemsSolved++;
  }

  await user.save();
  res.json({ message: "Response submitted", correct: isCorrect });
});

// API to fetch leaderboard
app.get("/leaderboard", async (req, res) => {
  const topPlayers = await User.find()
    .sort({ problemsSolved: -1, attempts: 1 })
    .limit(10)
    .select("name problemsSolved attempts -_id");

  res.json(topPlayers);
});

// Weekly reset function
const resetLeaderboard = async () => {
  const latestWeek = (await Leaderboard.findOne().sort({ week: -1 }))?.week || 0;
  const newWeek = latestWeek + 1;

  const topPlayers = await User.find()
    .sort({ problemsSolved: -1, attempts: 1 })
    .limit(3)
    .select("name problemsSolved attempts -_id");

  await Leaderboard.create({ week: newWeek, topPlayers });
  await User.updateMany({}, { $set: { problemsSolved: 0, responses: [] } });
  await Problem.create({ week: newWeek, correctAnswer: "NewAnswerHere" });

  console.log(`✅ Week ${newWeek} has started with a new problem!`);
};

// Schedule weekly reset (Runs every Sunday at midnight UTC)
cron.schedule("0 0 * * 0", resetLeaderboard);

// Serve Frontend (if deployed on Render/Vercel)
if (process.env.NODE_ENV === "production") {
  const path = require("path");
  app.use(express.static(path.join(__dirname, "../frontend/build")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/build", "index.html"));
  });
}

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
