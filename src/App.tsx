/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  signInAnonymously, 
  onAuthStateChanged, 
  User as FirebaseUser 
} from "firebase/auth";
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  query, 
  where, 
  limit, 
  Timestamp, 
  onSnapshot,
  addDoc,
  deleteDoc,
  getDocFromServer
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { motion, AnimatePresence } from "motion/react";
import { 
  Key, 
  Copy, 
  Check, 
  Settings, 
  Plus, 
  Trash2, 
  Clock, 
  ShieldCheck, 
  AlertCircle, 
  X 
} from "lucide-react";

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: any[];
  }
}

// --- Constants ---
const COOLDOWN_HOURS = 24;
const INITIAL_KEYS = [
  "Bt8a2Kx91LpQ", "BtZ39sD8wQ1x", "Bt2jH8skP0aM", "Bt9Qw82nXzL1", "BtL0p29XvQ8a",
  "Bt3Xn91aKqZ8", "Bt8vQ2Lm0ZpA", "BtP92nX8sWq1", "Bt0aX9L2qPw8", "Bt92KxLm1QaZ",
  "Bt7nQw2X9LpA", "BtX9p0L2aQ8n", "Bt3Kp92XwZa1", "Bt8Qn2LxP0aM", "BtZ1x92PwQa8",
  "Bt2LpX8nQ9a0", "Bt9aP2XwLQ8n", "BtX0n92QaLp8", "Bt8Lp2XnQ9aW", "BtQ92xL0PnA8",
  "BtA92xLmP0Qz", "BtK2x9LpQ0aZ", "BtX92LpQa0Nz", "Bt2ZxP9LnQa0", "BtLx90Qa2PnZ",
  "Bt8QaL2PnX90", "Bt0Pn2QaLxZ9", "Bt92QaLxP0Zn", "BtQx2PnL0Za9", "BtL92xQ0PnZa"
];

// --- Helpers ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

const Countdown = ({ targetDate, hours, onEnd }: { targetDate: Date, hours: number, onEnd?: () => void }) => {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const calculate = () => {
      const now = new Date();
      const end = new Date(targetDate.getTime() + hours * 60 * 60 * 1000);
      const diff = end.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft("00:00:00");
        if (onEnd) onEnd();
        return;
      }

      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft(
        `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      );
    };

    calculate();
    const timer = setInterval(calculate, 1000);
    return () => clearInterval(timer);
  }, [targetDate, hours, onEnd]);

  return <span>{timeLeft}</span>;
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<Date | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Admin State
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [allKeys, setAllKeys] = useState<any[]>([]);
  const [newKeyInput, setNewKeyInput] = useState("");
  const [bulkKeyInput, setBulkKeyInput] = useState("");
  const [isBulkMode, setIsBulkMode] = useState(false);

  const addBulkKeys = async () => {
    const keys = bulkKeyInput
      .split(/[\n,]+/)
      .map(k => k.trim())
      .filter(k => k.length > 0);
    
    if (keys.length === 0) return;
    
    setLoading(true);
    try {
      for (const k of keys) {
        const q = query(collection(db, "keys"), where("key", "==", k));
        const snap = await getDocs(q);
        if (snap.empty) {
          await addDoc(collection(db, "keys"), {
            key: k,
            lastUsedAt: null
          });
        }
      }
      setBulkKeyInput("");
      setIsBulkMode(false);
      alert(`${keys.length} keys processadas com sucesso!`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "keys");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        const userDocRef = doc(db, "users", u.uid);
        try {
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.lastGeneratedAt) {
              setLastGeneratedAt(data.lastGeneratedAt.toDate());
            }
          }
        } catch (err) {
          console.error("Error fetching user data", err);
        }
      } else {
        signInAnonymously(auth).catch(err => console.error("Auth error", err));
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    if (!isAdminAuthenticated) return;
    const q = collection(db, "keys");
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const keys = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAllKeys(keys);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, "keys");
    });
    return () => unsubscribe();
  }, [isAdminAuthenticated]);

  const generateKey = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const now = new Date();
      if (lastGeneratedAt) {
        const diff = now.getTime() - lastGeneratedAt.getTime();
        const hoursDiff = diff / (1000 * 60 * 60);
        if (hoursDiff < COOLDOWN_HOURS) {
          const remaining = Math.ceil(COOLDOWN_HOURS - hoursDiff);
          setError(`Você já gerou uma key recentemente. Tente novamente em ${remaining} horas.`);
          setLoading(false);
          return;
        }
      }

      const keysRef = collection(db, "keys");
      const q = query(keysRef, limit(100)); 
      const querySnapshot = await getDocs(q);
      
      let availableKeyDoc = null;
      for (const doc of querySnapshot.docs) {
        const data = doc.data();
        if (!data.lastUsedAt) {
          availableKeyDoc = doc;
          break;
        } else {
          const lastUsed = data.lastUsedAt.toDate();
          const diff = now.getTime() - lastUsed.getTime();
          if (diff / (1000 * 60 * 60) >= COOLDOWN_HOURS) {
            availableKeyDoc = doc;
            break;
          }
        }
      }

      if (!availableKeyDoc) {
        setError("Nenhuma key disponível no momento. Tente mais tarde.");
        setLoading(false);
        return;
      }

      const keyData = availableKeyDoc.data();
      await updateDoc(doc(db, "keys", availableKeyDoc.id), {
        lastUsedAt: Timestamp.now()
      });

      await setDoc(doc(db, "users", user.uid), {
        lastGeneratedAt: Timestamp.now()
      }, { merge: true });

      setGeneratedKey(keyData.key);
      setLastGeneratedAt(now);
      setLoading(false);
    } catch (err) {
      setLoading(false);
      setError("Erro ao gerar key. Tente novamente.");
      handleFirestoreError(err, OperationType.UPDATE, "keys/users");
    }
  };

  const copyToClipboard = () => {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPassword === "Patolino123@") {
      setIsAdminAuthenticated(true);
      setAdminPassword("");
    } else {
      alert("Senha incorreta!");
    }
  };

  const addKey = async () => {
    if (!newKeyInput.trim()) return;
    try {
      await addDoc(collection(db, "keys"), {
        key: newKeyInput.trim(),
        lastUsedAt: null
      });
      setNewKeyInput("");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "keys");
    }
  };

  const deleteKey = async (id: string) => {
    try {
      await deleteDoc(doc(db, "keys", id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `keys/${id}`);
    }
  };

  const bootstrapKeys = async () => {
    try {
      for (const k of INITIAL_KEYS) {
        const q = query(collection(db, "keys"), where("key", "==", k));
        const snap = await getDocs(q);
        if (snap.empty) {
          await addDoc(collection(db, "keys"), {
            key: k,
            lastUsedAt: null
          });
        }
      }
      alert("Keys iniciais adicionadas!");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "keys");
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-white font-sans">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <Clock className="w-8 h-8 opacity-50" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-orange-500/30">
      {/* Main Content */}
      <main className="max-w-md mx-auto px-6 pt-24 pb-12 flex flex-col items-center text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12"
        >
          <div className="w-16 h-16 bg-orange-500/10 rounded-2xl flex items-center justify-center mb-6 mx-auto border border-orange-500/20">
            <Key className="w-8 h-8 text-orange-500" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Gerador de Keys</h1>
          <p className="text-neutral-500 text-sm">Sorteie uma key exclusiva a cada 24 horas.</p>
        </motion.div>

        <div className="w-full space-y-6">
          {/* Key Display */}
          <AnimatePresence mode="wait">
            {generatedKey ? (
              <motion.div
                key="key-display"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 relative group"
              >
                <div className="text-xs font-mono text-neutral-500 uppercase tracking-widest mb-2">Sua Key</div>
                <div className="text-2xl font-mono font-bold text-white break-all tracking-wider">
                  {generatedKey}
                </div>
                <button
                  onClick={copyToClipboard}
                  className="absolute top-4 right-4 p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 transition-colors text-neutral-400 hover:text-white"
                >
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-32 flex items-center justify-center border-2 border-dashed border-neutral-800 rounded-2xl text-neutral-600 italic text-sm"
              >
                Nenhuma key gerada ainda
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm flex items-start gap-3 text-left"
            >
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          {/* Generate Button */}
          <button
            onClick={generateKey}
            disabled={loading}
            className={`w-full py-4 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${
              loading 
                ? "bg-neutral-800 text-neutral-500 cursor-not-allowed" 
                : "bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/20 active:scale-[0.98]"
            }`}
          >
            {loading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
              >
                <Clock className="w-5 h-5" />
              </motion.div>
            ) : (
              <>
                <Key className="w-5 h-5" />
                Gerar Nova Key
              </>
            )}
          </button>

          {/* Cooldown Info */}
          {lastGeneratedAt && (
            <div className="text-xs text-neutral-500 flex flex-col items-center justify-center gap-2">
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3" />
                {(() => {
                  const now = new Date();
                  const diff = now.getTime() - lastGeneratedAt.getTime();
                  const hoursDiff = diff / (1000 * 60 * 60);
                  if (hoursDiff < COOLDOWN_HOURS) {
                    return (
                      <span>
                        Próxima geração em: <Countdown targetDate={lastGeneratedAt} hours={COOLDOWN_HOURS} />
                      </span>
                    );
                  }
                  return <span>Geração disponível!</span>;
                })()}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Hidden Admin Trigger */}
      <button
        onClick={() => setIsAdminOpen(true)}
        className="fixed bottom-4 right-4 w-8 h-8 opacity-0 hover:opacity-20 transition-opacity cursor-default"
        title="Admin"
      >
        <Settings className="w-full h-full" />
      </button>

      {/* Admin Modal */}
      <AnimatePresence>
        {isAdminOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdminOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-5 h-5 text-orange-500" />
                  <h2 className="font-bold">Painel Administrativo</h2>
                </div>
                <button 
                  onClick={() => setIsAdminOpen(false)}
                  className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 max-h-[70vh] overflow-y-auto">
                {!isAdminAuthenticated ? (
                  <form onSubmit={handleAdminLogin} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-neutral-500 uppercase">Senha de Acesso</label>
                      <input
                        type="password"
                        autoFocus
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 focus:outline-none focus:border-orange-500 transition-colors"
                        placeholder="••••••••"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-3 bg-white text-black font-bold rounded-xl hover:bg-neutral-200 transition-colors"
                    >
                      Acessar Painel
                    </button>
                  </form>
                ) : (
                  <div className="space-y-8">
                    {/* Add Key Section */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider">
                          {isBulkMode ? "Importar em Massa" : "Adicionar Key"}
                        </h3>
                        <button 
                          onClick={() => setIsBulkMode(!isBulkMode)}
                          className="text-xs text-orange-500 hover:underline"
                        >
                          {isBulkMode ? "Modo Individual" : "Modo em Massa"}
                        </button>
                      </div>

                      {isBulkMode ? (
                        <div className="space-y-3">
                          <textarea
                            value={bulkKeyInput}
                            onChange={(e) => setBulkKeyInput(e.target.value)}
                            className="w-full h-32 bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 focus:outline-none focus:border-orange-500 transition-colors font-mono text-sm"
                            placeholder="Cole as keys aqui (uma por linha ou separadas por vírgula)..."
                          />
                          <button
                            onClick={addBulkKeys}
                            disabled={loading}
                            className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors disabled:opacity-50"
                          >
                            {loading ? "Processando..." : "Importar Todas"}
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newKeyInput}
                            onChange={(e) => setNewKeyInput(e.target.value)}
                            className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 focus:outline-none focus:border-orange-500 transition-colors"
                            placeholder="Ex: BT-XXXX-XXXX"
                          />
                          <button
                            onClick={addKey}
                            className="bg-orange-500 hover:bg-orange-600 p-2 rounded-xl transition-colors"
                          >
                            <Plus className="w-6 h-6" />
                          </button>
                        </div>
                      )}
                      
                      {!isBulkMode && (
                        <button
                          onClick={bootstrapKeys}
                          className="text-xs text-orange-500 hover:underline"
                        >
                          Adicionar Keys Iniciais (Bootstrap)
                        </button>
                      )}
                    </div>

                    {/* Keys List */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider">
                          Keys Registradas ({allKeys.length})
                        </h3>
                      </div>
                      <div className="space-y-2">
                        {allKeys.map((k) => (
                          <div 
                            key={k.id}
                            className="bg-neutral-950 border border-neutral-800 p-3 rounded-xl flex items-center justify-between group"
                          >
                            <div className="flex flex-col">
                              <span className="font-mono text-sm">{k.key}</span>
                              <div className="flex items-center gap-2 text-[10px] text-neutral-600">
                                {(() => {
                                  if (!k.lastUsedAt) return <span>Disponível</span>;
                                  const lastUsed = k.lastUsedAt.toDate();
                                  const now = new Date();
                                  const diff = now.getTime() - lastUsed.getTime();
                                  const hoursDiff = diff / (1000 * 60 * 60);
                                  
                                  if (hoursDiff < COOLDOWN_HOURS) {
                                    return (
                                      <span className="text-orange-500/70 flex items-center gap-1">
                                        <Clock className="w-2 h-2" />
                                        Cooldown: <Countdown targetDate={lastUsed} hours={COOLDOWN_HOURS} />
                                      </span>
                                    );
                                  }
                                  return <span>Disponível (Usada em: {lastUsed.toLocaleString()})</span>;
                                })()}
                              </div>
                            </div>
                            <button
                              onClick={() => deleteKey(k.id)}
                              className="p-2 text-neutral-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                        {allKeys.length === 0 && (
                          <div className="text-center py-8 text-neutral-600 text-sm italic">
                            Nenhuma key cadastrada
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="fixed bottom-8 left-0 right-0 text-center pointer-events-none">
        <p className="text-[10px] text-neutral-700 uppercase tracking-[0.2em]">
          Secure Key Distribution System v1.0
        </p>
      </footer>
    </div>
  );
}
