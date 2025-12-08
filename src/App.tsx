import React, { useState, useEffect, useRef, useMemo } from 'react';
// 如果這邊出現紅字，等一下預覽視窗會有按鈕可以修復
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  query, 
  onSnapshot
} from 'firebase/firestore';
import { 
  Play, 
  Users, 
  User, 
  Timer, 
  Calculator, 
  Trophy, 
  AlertCircle,
  LogOut,
  PenTool,
  Clock,
  ArrowUpDown
} from 'lucide-react';

// --- Firebase Config & Init ---
// ★★★ 請在這裡填入您從 Firebase 後台複製的設定 ★★★
const firebaseConfig = {
  apiKey: "AIzaSyCJi5MPLhkSJwbjVZvxfgN-e-6WjO2n5ko",
  authDomain: "steam-lock-1a2b.firebaseapp.com",
  projectId: "steam-lock-1a2b",
  storageBucket: "steam-lock-1a2b.firebasestorage.app",
  messagingSenderId: "728514736562",
  appId: "1:728514736562:web:4be2040aca3d61254d34ab",
  measurementId: "G-04MGJ4Y98C"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'class-game-001'; // 班級代號

// --- Types ---
type GameMode = 'single' | 'multi';
type Difficulty = 'standard' | 'challenge' | 'master';
type GameState = 'login' | 'setup' | 'setting_answer' | 'playing' | 'finished';
type SortOption = 'duration' | 'guessCount';

interface GuessRecord {
  guess: string;
  a: number;
  b: number;
  isTimeout?: boolean;
}

interface LeaderboardEntry {
  id: string;
  playerName: string;
  mode: GameMode;
  difficulty: Difficulty;
  guessCount: number;
  duration: number;
  timestamp: number;
}

// --- Helper Functions ---
const generateAllPossibilities = (diff: Difficulty): string[] => {
  const possibilities: string[] = [];
  if (diff === 'master') {
    for (let i = 0; i < 10000; i++) possibilities.push(i.toString().padStart(4, '0'));
  } else {
    const isStandard = diff === 'standard';
    for (let i = 0; i < 10000; i++) {
      const s = i.toString().padStart(4, '0');
      const set = new Set(s);
      if (set.size !== 4) continue;
      if (isStandard && s[0] === '0') continue;
      possibilities.push(s);
    }
  }
  return possibilities;
};

const calculateResult = (answer: string, guess: string) => {
  let a = 0;
  let b = 0;
  for (let i = 0; i < 4; i++) {
    if (answer[i] === guess[i]) a++;
  }
  const answerCounts: Record<string, number> = {};
  const guessCounts: Record<string, number> = {};
  for (let i = 0; i < 4; i++) {
    const ansChar = answer[i];
    const guessChar = guess[i];
    if (ansChar !== guessChar) {
      answerCounts[ansChar] = (answerCounts[ansChar] || 0) + 1;
      guessCounts[guessChar] = (guessCounts[guessChar] || 0) + 1;
    }
  }
  for (const char in guessCounts) {
    if (answerCounts[char]) b += Math.min(guessCounts[char], answerCounts[char]);
  }
  return { a, b };
};

// --- Components ---

export default function App() {
  // --- Global State ---
  const [user, setUser] = useState<any>(null);
  const [playerName, setPlayerName] = useState('');
  const [gameState, setGameState] = useState<GameState>('login');
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  
  // --- Game Config State ---
  const [mode, setMode] = useState<GameMode>('single');
  const [difficulty, setDifficulty] = useState<Difficulty>('standard');
  const [useTimer, setUseTimer] = useState(false);
  const [timerLimit, setTimerLimit] = useState(60); 
  
  // --- Gameplay State ---
  const [answer, setAnswer] = useState('');
  const [currentGuess, setCurrentGuess] = useState('');
  const [history, setHistory] = useState<GuessRecord[]>([]);
  const [startTime, setStartTime] = useState<number>(0);
  const [remainingPossibilities, setRemainingPossibilities] = useState<number>(0);
  const [possibilityList, setPossibilityList] = useState<string[]>([]);
  
  // Multi-player specific
  const [multiplayerTurn, setMultiplayerTurn] = useState<'p1_playing' | 'p2_playing'>('p1_playing');
  const [p2Name, setP2Name] = useState(''); 
  const [currentSetterName, setCurrentSetterName] = useState('');
  const [currentGuesserName, setCurrentGuesserName] = useState('');

  // Timer State
  const [timeLeft, setTimeLeft] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0); 
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Leaderboard State
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardFilterDiff, setLeaderboardFilterDiff] = useState<Difficulty>('standard');
  const [leaderboardSortBy, setLeaderboardSortBy] = useState<SortOption>('duration');

  // --- Auth & Init ---
  useEffect(() => {
    // 這裡使用匿名登入
    const initAuth = async () => {
        try {
            await signInAnonymously(auth);
        } catch (error) {
            console.error("登入失敗", error);
        }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  // --- Leaderboard Listener ---
  useEffect(() => {
    if (!user) return;
    // 使用簡單的查詢，避免需要複雜的索引
    const q = query(collection(db, 'leaderboard'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: LeaderboardEntry[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() } as LeaderboardEntry));
      setLeaderboard(data);
    }, (err) => console.error("Leaderboard error", err));
    return () => unsubscribe();
  }, [user]);

  // --- Elapsed Time Timer ---
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (gameState === 'playing') {
      interval = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [gameState]);

  // --- Game Logic ---
  const resetGame = () => {
    setHistory([]);
    setCurrentGuess('');
    setStartTime(Date.now());
    setElapsedTime(0); 
    const all = generateAllPossibilities(difficulty);
    setPossibilityList(all);
    setRemainingPossibilities(all.length);
    if (useTimer) {
      setTimeLeft(timerLimit);
      startTimer();
    }
  };

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          handleTimeout();
          return timerLimit;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleTimeout = () => {
    const penaltyRecord: GuessRecord = { guess: "逾時", a: 0, b: 0, isTimeout: true };
    setHistory(prev => [...prev, penaltyRecord]);
    setTimeLeft(timerLimit); 
  };

  const startGame = () => {
    if (mode === 'single') {
      const all = generateAllPossibilities(difficulty);
      setAnswer(all[Math.floor(Math.random() * all.length)]);
      setCurrentGuesserName(playerName);
      setGameState('playing');
      resetGame();
    } else {
      setCurrentSetterName(playerName);
      setCurrentGuesserName(p2Name || '玩家 2');
      setGameState('setting_answer');
      setCurrentGuess(''); 
    }
  };

  const isValidInput = (val: string) => {
    if (val.length !== 4) return false;
    if (!/^\d+$/.test(val)) return false;
    if (difficulty === 'standard') {
      if (val[0] === '0') return false; 
      if (new Set(val).size !== 4) return false;
    }
    if (difficulty === 'challenge') {
      if (new Set(val).size !== 4) return false;
    }
    return true;
  };

  const updatePossibilities = (lastGuess: string, lastA: number, lastB: number) => {
    const newList = possibilityList.filter(candidate => {
      const res = calculateResult(candidate, lastGuess);
      return res.a === lastA && res.b === lastB;
    });
    setPossibilityList(newList);
    setRemainingPossibilities(newList.length);
  };

  const handleSetAnswer = () => {
    if (!isValidInput(currentGuess)) {
      alert("出題不符合規則，請重新輸入！");
      return;
    }
    setAnswer(currentGuess);
    setCurrentGuess('');
    setGameState('playing');
    resetGame();
  };

  const handleGuess = async () => {
    if (!isValidInput(currentGuess)) return;
    const { a, b } = calculateResult(answer, currentGuess);
    const newHistory = [...history, { guess: currentGuess, a, b }];
    setHistory(newHistory);
    updatePossibilities(currentGuess, a, b);
    setCurrentGuess('');
    if (useTimer) setTimeLeft(timerLimit);

    if (a === 4) {
      stopTimer();
      await saveScore(newHistory.length);
      if (mode === 'multi' && multiplayerTurn === 'p1_playing') {
        setTimeout(() => {
            alert(`${currentGuesserName} 猜對了！換人出題！`);
            setMultiplayerTurn('p2_playing');
            const temp = p2Name || '玩家 2';
            setCurrentSetterName(temp);
            setCurrentGuesserName(playerName);
            setGameState('setting_answer');
            setHistory([]);
        }, 500);
      } else {
        setGameState('finished');
      }
    }
  };

  const saveScore = async (finalCount: number) => {
    if (!user) return;
    try {
      const timeTaken = Math.floor((Date.now() - startTime) / 1000);
      // 這裡改為簡單的 collection 名稱
      await addDoc(collection(db, 'leaderboard'), {
        playerName: currentGuesserName,
        mode,
        difficulty,
        guessCount: finalCount,
        duration: timeTaken,
        timestamp: Date.now()
      });
    } catch (e) { console.error("Error saving score", e); }
  };

  // --- Filter and Sort Leaderboard ---
  const filteredLeaderboard = useMemo(() => {
    const data = leaderboard.filter(entry => entry.mode === mode && entry.difficulty === leaderboardFilterDiff);
    
    return data.sort((a, b) => {
      if (leaderboardSortBy === 'duration') {
        if (a.duration !== b.duration) return a.duration - b.duration;
        return a.guessCount - b.guessCount;
      } else {
        if (a.guessCount !== b.guessCount) return a.guessCount - b.guessCount;
        return a.duration - b.duration;
      }
    });
  }, [leaderboard, mode, leaderboardFilterDiff, leaderboardSortBy]);

  // --- Chalkboard Styles (Injecting Font) ---
  const chalkboardFont = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Patrick+Hand&display=swap');
      .font-chalk { font-family: 'Patrick Hand', 'Caveat', cursive; }
      .chalk-border { border-style: solid; border-radius: 2px; }
      .chalk-box { box-shadow: 2px 2px 0px rgba(255,255,255,0.1); }
      .chalk-text-shadow { text-shadow: 1px 1px 0px rgba(0,0,0,0.2); }
      .eraser-effect:active { opacity: 0.7; transform: scale(0.98); }
    `}</style>
  );

  // --- Modal for Exit Confirmation ---
  const ExitConfirmModal = () => (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[#2a4d3d] border-4 border-white/80 p-8 max-w-sm w-full relative shadow-2xl transform rotate-1">
         <div className="absolute top-2 left-2 w-2 h-2 bg-gray-400 rounded-full border border-gray-600"></div>
         <div className="absolute top-2 right-2 w-2 h-2 bg-gray-400 rounded-full border border-gray-600"></div>
         
         <h3 className="text-2xl text-[#ffadad] font-bold mb-4 text-center">確定要下課了嗎？</h3>
         <p className="text-white/80 text-center mb-6 text-lg">目前的遊戲進度將會消失，黑板會被擦乾淨喔！</p>
         
         <div className="flex gap-4">
           <button 
             onClick={() => setShowExitConfirm(false)}
             className="flex-1 py-2 border-2 border-white/30 text-white hover:bg-white/10 rounded transition-colors"
           >
             繼續上課
           </button>
           <button 
             onClick={() => {
                setShowExitConfirm(false);
                setGameState('login');
                setPlayerName('');
                setHistory([]);
             }}
             className="flex-1 py-2 bg-[#ffadad] text-[#234234] font-bold rounded shadow-lg hover:bg-[#ffc1c1] transition-colors"
           >
             確定離開
           </button>
         </div>
      </div>
    </div>
  );

  // --- Render Sections ---

  if (gameState === 'login') {
    return (
      <div className="min-h-screen bg-[#234234] flex items-center justify-center p-4 font-chalk text-white">
        {chalkboardFont}
        <div className="border-4 border-white/80 p-10 max-w-md w-full relative bg-[#2a4d3d] shadow-2xl">
          <div className="absolute top-2 left-2 w-3 h-3 bg-gray-400 rounded-full border border-gray-600"></div>
          <div className="absolute top-2 right-2 w-3 h-3 bg-gray-400 rounded-full border border-gray-600"></div>
          <div className="absolute bottom-2 left-2 w-3 h-3 bg-gray-400 rounded-full border border-gray-600"></div>
          <div className="absolute bottom-2 right-2 w-3 h-3 bg-gray-400 rounded-full border border-gray-600"></div>

          <h1 className="text-5xl font-bold text-center mb-8 flex flex-col items-center gap-2 text-[#fff9c4] chalk-text-shadow">
            <Calculator className="w-12 h-12 text-[#ffadad]" />
            1A2B 數碼偵探
          </h1>
          <div className="space-y-6">
            <div>
              <label className="block text-xl mb-2 text-[#a0c4ff]">各位同學，請寫下名字：</label>
              <input 
                type="text" 
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="w-full bg-transparent border-b-2 border-white/50 text-2xl py-2 px-2 focus:border-[#ffadad] outline-none placeholder-white/20 text-center"
                placeholder="Name..."
              />
            </div>
            <button 
              onClick={() => { if(playerName.trim()) setGameState('setup'); }}
              disabled={!playerName.trim()}
              className="w-full border-2 border-dashed border-white/60 hover:border-white hover:bg-white/10 text-2xl py-3 rounded eraser-effect transition-all text-[#9bf6ff] font-bold"
            >
              開始上課 (Start)
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'setup') {
    return (
      <div className="min-h-screen bg-[#234234] flex items-center justify-center p-4 font-chalk text-white">
        {chalkboardFont}
        <div className="border-2 border-white/30 p-8 w-full max-w-3xl bg-[#2a4d3d] relative">
          <h2 className="text-4xl font-bold text-[#fff9c4] mb-8 border-b-2 border-dashed border-white/30 pb-4 flex items-center gap-3">
            <PenTool className="w-8 h-8" /> 課程設定
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {/* Left */}
            <div className="space-y-8">
              <div>
                <label className="text-2xl text-[#a0c4ff] mb-4 block flex items-center gap-2">
                  <Users className="w-6 h-6" /> 選擇模式
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setMode('single')}
                    className={`p-4 border-2 ${mode === 'single' ? 'border-[#ffadad] text-[#ffadad] bg-white/5' : 'border-white/30 text-white/50'} text-xl rounded transition-all transform hover:-rotate-1`}
                  >
                    單人自習
                  </button>
                  <button 
                    onClick={() => setMode('multi')}
                    className={`p-4 border-2 ${mode === 'multi' ? 'border-[#ffadad] text-[#ffadad] bg-white/5' : 'border-white/30 text-white/50'} text-xl rounded transition-all transform hover:rotate-1`}
                  >
                    雙人對戰
                  </button>
                </div>
                {mode === 'multi' && (
                   <input 
                     type="text"
                     value={p2Name}
                     onChange={(e) => setP2Name(e.target.value)}
                     placeholder="第二位同學名字..."
                     className="w-full mt-4 bg-transparent border-b border-white/30 px-2 py-1 text-lg outline-none focus:border-[#ffadad]"
                   />
                )}
              </div>

              <div>
                <label className="text-2xl text-[#a0c4ff] mb-4 block flex items-center gap-2">
                  <AlertCircle className="w-6 h-6" /> 難度 (Grade)
                </label>
                <div className="space-y-3">
                  {(['standard', 'challenge', 'master'] as Difficulty[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={`w-full p-3 text-left flex justify-between items-center border-b ${difficulty === d ? 'border-[#ffd6a5] text-[#ffd6a5]' : 'border-white/20 text-white/60'}`}
                    >
                      <span className="text-xl">
                        {d === 'standard' && '標準題 (Standard)'}
                        {d === 'challenge' && '挑戰題 (Challenge)'}
                        {d === 'master' && '大師題 (Master)'}
                      </span>
                      <span className="text-sm opacity-80 font-sans">
                        {d === 'standard' && '不重複、無0開頭'}
                        {d === 'challenge' && '不重複、可0開頭'}
                        {d === 'master' && '可重複、可0開頭'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right */}
            <div className="space-y-8">
              <div>
                <label className="text-2xl text-[#a0c4ff] mb-4 block flex items-center gap-2">
                  <Timer className="w-6 h-6" /> 考試時間
                </label>
                <div className="flex items-center gap-4 mb-4">
                  <button 
                    onClick={() => setUseTimer(!useTimer)}
                    className={`w-12 h-6 rounded-full border-2 border-white flex items-center p-1 transition-colors ${useTimer ? 'bg-[#ffadad]/50' : 'bg-transparent'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full transition-transform ${useTimer ? 'translate-x-5' : ''}`}></div>
                  </button>
                  <span className="text-xl">{useTimer ? '開啟 (On)' : '不限時 (Off)'}</span>
                </div>
                
                {useTimer && (
                  <div className="p-4 border border-dashed border-white/40 rounded bg-white/5">
                    <p className="text-sm text-[#ffd6a5] mb-2">每回合秒數</p>
                    <input 
                      type="range" 
                      min="5" max="300" step="5"
                      value={timerLimit}
                      onChange={(e) => setTimerLimit(parseInt(e.target.value))}
                      className="w-full accent-[#ffadad]"
                    />
                    <div className="text-center font-bold text-2xl mt-1 text-white">
                      {Math.floor(timerLimit / 60)}m {timerLimit % 60}s
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-8">
                 <button 
                  onClick={startGame}
                  className="w-full border-2 border-white bg-[#ffd6a5] hover:bg-[#ffe0b2] text-[#234234] text-3xl font-bold py-4 rounded-sm shadow-[4px_4px_0px_rgba(255,255,255,0.2)] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_rgba(255,255,255,0.2)] transition-all flex items-center justify-center gap-3"
                >
                  <Play className="w-8 h-8" />
                  開始作答
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Main Game Screen ---
  const isSettingAnswer = gameState === 'setting_answer';
  const isFinished = gameState === 'finished';

  return (
    <div className="min-h-screen bg-[#234234] p-2 md:p-6 font-chalk text-white overflow-hidden">
      {chalkboardFont}
      {showExitConfirm && <ExitConfirmModal />}
      
      {/* Top Bar */}
      <div className="flex justify-between items-center mb-6 px-4 border-b border-white/20 pb-4">
        <div className="text-xl md:text-3xl text-[#ffd6a5] flex items-center gap-2">
            <User className="w-6 h-6" />
            {isSettingAnswer 
              ? `${currentSetterName} 老師出題中...` 
              : `${currentGuesserName} 同學作答中`}
        </div>
        <div className="text-white/50 text-sm md:text-xl">
            {getDifficultyText(difficulty)}
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
        
        {/* Left: Blackboard Area */}
        <div className="border-[6px] border-[#5d4037] bg-[#2a4d3d] shadow-2xl relative min-h-[600px] flex flex-col p-6 rounded-sm">
          <div className="absolute top-2 left-2 w-2 h-2 bg-[#3e2723] rounded-full opacity-50"></div>
          <div className="absolute top-2 right-2 w-2 h-2 bg-[#3e2723] rounded-full opacity-50"></div>
          
          {/* Answer Display */}
          <div className="flex justify-center gap-3 md:gap-4 my-8">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="w-16 h-20 md:w-20 md:h-24 border-2 border-white/90 flex items-center justify-center text-5xl md:text-6xl font-bold bg-white/5 relative">
                {isSettingAnswer 
                  ? (currentGuess[i] || '') 
                  : (isFinished)
                    ? answer[i] 
                    : <span className="text-white/20 text-4xl">?</span>
                }
                <div className="absolute inset-0 bg-white/5 pointer-events-none"></div>
              </div>
            ))}
          </div>
          
          {/* Input Area */}
          <div className="mb-6 flex flex-col items-center">
             {isFinished ? (
              <div className="text-center">
                <h3 className="text-4xl text-[#9bf6ff] mb-4">下課鐘聲響起！</h3>
                <p className="text-2xl mb-6">
                  {history[history.length-1]?.a === 4 
                    ? `太棒了！共猜了 ${history.length} 次，花費的總時間為 ${Math.floor(elapsedTime / 60)}分${(elapsedTime % 60).toString().padStart(2, '0')}秒`
                    : `再接再厲！`}
                </p>
                <div className="flex gap-6">
                    <button 
                      onClick={() => setGameState('setup')}
                      className="px-6 py-2 border border-white/50 hover:bg-white/10 rounded text-xl"
                    >
                      調整設定
                    </button>
                    <button 
                      onClick={() => {
                          if (mode === 'single') startGame();
                          else setGameState('setup');
                      }}
                      className="px-6 py-2 bg-[#ffd6a5] text-[#234234] font-bold rounded text-xl shadow-[2px_2px_0px_white]"
                    >
                      再玩一次
                    </button>
                </div>
              </div>
            ) : (
              <div className="w-full max-w-sm relative">
                 {/* Elapsed Time */}
                 {!isSettingAnswer && (
                   <div className="hidden md:flex absolute -right-32 top-1/2 -translate-y-1/2 flex-col items-center transform -rotate-3 opacity-90">
                      <Clock className="w-8 h-8 text-[#ffd6a5] mb-1" />
                      <div className="text-2xl font-bold text-[#ffd6a5]">
                        {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
                      </div>
                      <div className="text-sm text-white/50 border-t border-white/30 pt-1 mt-1">Total Time</div>
                   </div>
                 )}
                 {!isSettingAnswer && (
                   <div className="flex md:hidden justify-center items-center gap-2 mb-2 text-[#ffd6a5] opacity-90">
                      <Clock className="w-4 h-4" />
                      <span className="text-lg font-bold">
                        {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
                      </span>
                   </div>
                 )}

                 <input 
                   type="text" 
                   maxLength={4}
                   value={currentGuess}
                   onChange={(e) => setCurrentGuess(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') isSettingAnswer ? handleSetAnswer() : handleGuess(); }}
                   className="w-full bg-transparent border-b-4 border-dashed border-white/30 text-center text-5xl py-2 mb-6 outline-none focus:border-[#ffadad] font-bold tracking-widest placeholder-white/10"
                   placeholder="_ _ _ _"
                 />
                 <button 
                    onClick={isSettingAnswer ? handleSetAnswer : handleGuess}
                    className="w-full border-2 border-white/80 hover:bg-white/10 text-white text-2xl font-bold py-3 rounded-sm transition-all flex items-center justify-center gap-2"
                 >
                   <PenTool className="w-5 h-5" />
                   {isSettingAnswer ? '寫在黑板上 (Set)' : '提交答案 (Guess)'}
                 </button>
              </div>
            )}
          </div>

          {/* History */}
          <div className="flex-1 overflow-y-auto border-t-2 border-white/20 pt-4 custom-scrollbar">
            <div className="grid grid-cols-12 gap-2 text-xl text-white/50 mb-2 border-b border-white/10 pb-2 px-2">
               <span className="col-span-2">No.</span>
               <span className="col-span-6 text-center">Guess</span>
               <span className="col-span-4 text-center">Result</span>
            </div>
            {history.map((record, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 text-2xl py-2 px-2 hover:bg-white/5 items-center font-bold">
                <span className="col-span-2 text-[#a0c4ff] font-sans text-lg pt-1">#{idx + 1}</span>
                <span className={`col-span-6 text-center tracking-widest ${record.isTimeout ? 'text-[#ffadad] line-through decoration-2' : 'text-white'}`}>
                  {record.guess}
                </span>
                <span className="col-span-4 text-center">
                   {record.isTimeout ? (
                     <span className="text-[#ffadad] text-lg">逾時</span>
                   ) : (
                     <span className={`${record.a === 4 ? 'text-[#9bf6ff]' : 'text-[#ffd6a5]'}`}>
                       {record.a}A{record.b}B
                     </span>
                   )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Dashboard Area */}
        <div className="flex flex-col gap-6">
          
          {/* Top Cards */}
          <div className="grid grid-cols-2 gap-4">
             {/* Timer */}
             <div className="border-2 border-white/30 p-4 relative bg-[#2a4d3d]">
               <h3 className="text-[#ffadad] text-xl flex items-center gap-2">
                 <Timer className="w-5 h-5" /> 倒數
               </h3>
               <div className={`text-5xl text-center mt-2 ${useTimer && timeLeft < 10 ? 'text-[#ffadad] animate-pulse' : 'text-white'}`}>
                 {useTimer ? `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}` : '--'}
               </div>
             </div>

             {/* Possibilities */}
             <div className="border-2 border-white/30 p-4 relative bg-[#2a4d3d]">
               <h3 className="text-[#a0c4ff] text-xl flex items-center gap-2">
                 <Calculator className="w-5 h-5" /> 可能性
               </h3>
               <div className="text-5xl text-center mt-2 text-[#ffd6a5]">
                 {isSettingAnswer ? '???' : remainingPossibilities}
               </div>
             </div>
          </div>

          {/* Leaderboard */}
          <div className="flex-1 border-4 border-[#8d6e63] bg-[#fff8e1] text-[#3e2723] p-4 relative shadow-lg flex flex-col min-h-[400px]">
             <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-red-600 shadow-md border border-red-800 z-10"></div>
             
             <div className="flex flex-col gap-3 mb-4 border-b-2 border-[#3e2723]/20 pb-3">
               <div className="flex justify-between items-center">
                 <h3 className="text-3xl font-bold flex items-center gap-2">
                   <Trophy className="w-6 h-6 text-yellow-600" /> 榮譽榜
                 </h3>
                 <div className="flex gap-1">
                   {['standard', 'challenge', 'master'].map((d: any) => (
                     <button 
                      key={d}
                      onClick={() => setLeaderboardFilterDiff(d)}
                      className={`px-2 py-1 text-sm border border-[#3e2723] ${leaderboardFilterDiff === d ? 'bg-[#3e2723] text-[#fff8e1]' : 'bg-transparent text-[#3e2723]'}`}
                     >
                       {d === 'standard' ? '標準' : d === 'challenge' ? '挑戰' : '大師'}
                     </button>
                   ))}
                 </div>
               </div>

               {/* Sort Toggles */}
               <div className="flex items-center gap-2 text-sm">
                  <span className="font-bold flex items-center gap-1"><ArrowUpDown className="w-4 h-4" /> 排序：</span>
                  <button 
                    onClick={() => setLeaderboardSortBy('duration')}
                    className={`px-3 py-0.5 rounded-full border border-[#3e2723] transition-all ${leaderboardSortBy === 'duration' ? 'bg-[#3e2723] text-white' : 'hover:bg-[#3e2723]/10'}`}
                  >
                    時間優先
                  </button>
                  <button 
                    onClick={() => setLeaderboardSortBy('guessCount')}
                    className={`px-3 py-0.5 rounded-full border border-[#3e2723] transition-all ${leaderboardSortBy === 'guessCount' ? 'bg-[#3e2723] text-white' : 'hover:bg-[#3e2723]/10'}`}
                  >
                    次數優先
                  </button>
               </div>
             </div>

             <div className="overflow-y-auto flex-1 font-sans">
               <table className="w-full text-left">
                 <thead className="text-[#3e2723]/60 border-b border-[#3e2723]/10">
                   <tr>
                     <th className="pb-2 pl-2">Rank</th>
                     <th className="pb-2">Name</th>
                     <th className="pb-2 text-center cursor-pointer hover:text-[#3e2723]" onClick={() => setLeaderboardSortBy('guessCount')}>
                        Guesses {leaderboardSortBy === 'guessCount' && '▼'}
                     </th>
                     <th className="pb-2 text-right pr-2 cursor-pointer hover:text-[#3e2723]" onClick={() => setLeaderboardSortBy('duration')}>
                        Time {leaderboardSortBy === 'duration' && '▼'}
                     </th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-[#3e2723]/10">
                   {filteredLeaderboard.slice(0, 50).map((entry, idx) => (
                     <tr key={entry.id} className="hover:bg-[#3e2723]/5">
                       <td className="py-2 pl-2 font-bold">
                         {idx < 3 ? ['🥇','🥈','🥉'][idx] : idx+1}
                       </td>
                       <td className="py-2 font-bold text-[#5d4037]">
                         {entry.playerName}
                         {entry.mode === 'multi' && <span className="ml-1 text-xs bg-[#5d4037] text-white px-1 rounded">2P</span>}
                       </td>
                       <td className={`py-2 text-center font-mono text-lg ${leaderboardSortBy === 'guessCount' ? 'font-bold bg-[#3e2723]/5' : ''}`}>
                         {entry.guessCount}
                       </td>
                       <td className={`py-2 text-right pr-2 font-mono text-sm ${leaderboardSortBy === 'duration' ? 'font-bold bg-[#3e2723]/5' : ''}`}>
                         {entry.duration}s
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
               {filteredLeaderboard.length === 0 && (
                 <div className="text-center py-10 opacity-50">暫無資料</div>
               )}
             </div>
          </div>
          
          {/* Back Home Button (Bottom Right) */}
          <div className="flex justify-end mt-2">
            <button 
              onClick={() => setShowExitConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 text-[#a0c4ff] hover:text-white border border-transparent hover:border-white/30 rounded transition-all text-xl"
            >
              <LogOut className="w-5 h-5" />
              回到首頁
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

function getDifficultyText(d: Difficulty) {
  switch (d) {
    case 'standard': return '標準 (Standard)';
    case 'challenge': return '挑戰 (Challenge)';
    case 'master': return '大師 (Master)';
  }
}