import React, { useState, useEffect, useRef } from 'react';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, getDocs, orderBy, limit, Timestamp } from 'firebase/firestore';
import { UserProfile, JournalEntry, DateLog, SexEncounter, InfectionNotification, AdminContent } from './types';
import { 
  Layout, 
  BookOpen, 
  Heart, 
  Activity, 
  ShieldAlert, 
  Settings, 
  LogOut, 
  Scan, 
  QrCode, 
  AlertCircle,
  Plus,
  Calendar,
  MessageSquare,
  User as UserIcon,
  ChevronRight,
  Save,
  Trash2,
  Bell,
  Mic,
  Video,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { format, subDays, isAfter, parseISO, addMonths, isBefore } from 'date-fns';
import { GoogleGenAI } from "@google/genai";

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const ConfirmModal: React.FC<{ show: boolean, onConfirm: () => void, onCancel: () => void, title: string, message: string }> = ({ show, onConfirm, onCancel, title, message }) => (
  <AnimatePresence>
    {show && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl"
        >
          <div className="flex items-center gap-3 text-red-500 mb-4">
            <AlertCircle className="w-8 h-8" />
            <h3 className="text-xl font-bold">{title}</h3>
          </div>
          <p className="text-stone-600 mb-8 leading-relaxed">{message}</p>
          <div className="flex gap-3">
            <button 
              onClick={onCancel}
              className="flex-1 py-3 bg-stone-100 text-stone-600 rounded-xl font-bold hover:bg-stone-200 transition-colors"
            >
              Anuluj
            </button>
            <button 
              onClick={onConfirm}
              className="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
            >
              Usuń
            </button>
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'journal' | 'dates' | 'sex' | 'admin'>('home');
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<InfectionNotification[]>([]);
  const [showTestReminder, setShowTestReminder] = useState(false);
  const [dueTests, setDueTests] = useState<string[]>([]);

  useEffect(() => {
    if (!profile) return;
    const due: string[] = [];
    const now = new Date();
    if (profile.nextHivTestDate && isBefore(parseISO(profile.nextHivTestDate), now)) {
      due.push('HIV');
    }
    if (profile.nextSyphilisTestDate && isBefore(parseISO(profile.nextSyphilisTestDate), now)) {
      due.push('Kiła');
    }
    if (due.length > 0) {
      setDueTests(due);
      setShowTestReminder(true);
    }
  }, [profile]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      console.log("Auth state changed:", u?.email);
      let targetUid = u?.uid;
      
      if (!u) {
        targetUid = 'guest_user_123';
        setUser({ uid: targetUid } as any);
      } else {
        setUser(u);
      }

      // Set up profile listener
      const profileRef = doc(db, 'users', targetUid!);
      const unsubProfile = onSnapshot(profileRef, async (docSnap) => {
        if (docSnap.exists()) {
          setProfile(docSnap.data() as UserProfile);
        } else {
          // Create profile if it doesn't exist
          const newProfile: UserProfile = {
            uid: targetUid!,
            displayName: u?.displayName || (targetUid === 'guest_user_123' ? 'Gość' : 'User'),
            email: u?.email || (targetUid === 'guest_user_123' ? 'guest@example.com' : ''),
            individualNumber: Math.floor(100000 + Math.random() * 900000).toString(),
            role: (u?.email === 'jakub.rezler82@gmail.com' || targetUid === 'guest_user_123') ? 'admin' : 'user'
          };
          await setDoc(profileRef, newProfile);
          setProfile(newProfile);
        }
        setLoading(false);
      }, (err) => {
        console.error("Profile listener error:", err);
        setLoading(false);
      });

      return () => unsubProfile();
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'notifications'), where('toUserId', '==', user.uid), where('read', '==', false));
    const unsub = onSnapshot(q, (snapshot) => {
      setNotifications(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as InfectionNotification)));
    }, (err) => {
      console.error("Notifications listener error:", err);
    });
    return () => unsub();
  }, [user]);

  const analyzeMood = async (text: string) => {
    try {
      // Add a timeout to the mood analysis
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Timeout")), 5000)
      );
      
      const analysisPromise = genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze the following journal entry for depressive states or suicidal thoughts. Return a JSON object with "moodScore" (1-10, 1 being very depressed, 10 being very happy) and "isDepressive" (boolean). Text: "${text}"`,
        config: { responseMimeType: "application/json" }
      });

      const result: any = await Promise.race([analysisPromise, timeoutPromise]);
      const jsonStr = result.text.trim();
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error("Mood analysis failed", e);
      return { moodScore: 5, isDepressive: false };
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-stone-50">Loading...</div>;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans">
      <div className="max-w-4xl mx-auto pb-24">
        <Header profile={profile} onLogout={() => signOut(auth)} activeTab={activeTab} setActiveTab={setActiveTab} notifications={notifications} />
        <main className="px-4 py-6">
          <AnimatePresence mode="wait">
            {activeTab === 'home' && <HomeTab key="home" />}
            {activeTab === 'journal' && <JournalTab key="journal" profile={profile} analyzeMood={analyzeMood} />}
            {activeTab === 'dates' && <DatesTab key="dates" profile={profile} />}
            {activeTab === 'sex' && <SexTab key="sex" profile={profile} />}
            {activeTab === 'admin' && <AdminTab key="admin" profile={profile} />}
          </AnimatePresence>
        </main>
        <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} isAdmin={profile?.role === 'admin'} />
      </div>
      <NotificationOverlay notifications={notifications} setNotifications={setNotifications} />
      {showTestReminder && <TestReminderOverlay dueTests={dueTests} onClose={() => setShowTestReminder(false)} />}
    </div>
  );
};

// --- Components ---

const TestReminderOverlay: React.FC<{ dueTests: string[], onClose: () => void }> = ({ dueTests, onClose }) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-stone-900/50 backdrop-blur-md">
    <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="bg-white p-8 rounded-[2rem] max-w-md w-full shadow-2xl border-4 border-emerald-100">
      <div className="flex justify-center mb-6">
        <div className="p-4 bg-emerald-100 rounded-full">
          <Calendar className="w-12 h-12 text-emerald-600" />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-center mb-4">Czas na badania!</h2>
      <p className="text-stone-600 text-center mb-8 leading-relaxed">
        Twoje zaplanowane badania są już zaległe: <br />
        <strong className="text-emerald-600">{dueTests.join(' i ')}</strong>. <br />
        Regularne testy to podstawa dbania o siebie i innych.
      </p>
      <button onClick={onClose} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold">Pamiętam, dziękuję</button>
    </motion.div>
  </div>
);

const HomeTab: React.FC = () => {
  const [content, setContent] = useState<AdminContent | null>(null);
  const [aboutContent, setAboutContent] = useState<AdminContent | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'admin_content'), where('slug', '==', 'landing'), limit(1));
    const unsubscribeLanding = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setContent({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as AdminContent);
      }
    });

    const qAbout = query(collection(db, 'admin_content'), where('slug', '==', 'about'), limit(1));
    const unsubscribeAbout = onSnapshot(qAbout, (snapshot) => {
      if (!snapshot.empty) {
        setAboutContent({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as AdminContent);
      }
    });

    return () => {
      unsubscribeLanding();
      unsubscribeAbout();
    };
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
      <div className="relative h-[500px] rounded-[3rem] overflow-hidden shadow-2xl group">
        <img 
          src="https://picsum.photos/seed/safeplace/1200/800" 
          alt="Safe Place" 
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/40 to-transparent"></div>
        <div className="absolute bottom-0 left-0 right-0 p-12">
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <h1 className="text-5xl font-black text-white mb-4 tracking-tighter uppercase italic leading-none">
              {content?.title || 'Przyjazny Zakątek'}
            </h1>
            <div className="max-w-2xl">
              <div className="prose prose-invert prose-lg max-w-none text-stone-200 font-medium leading-relaxed" dangerouslySetInnerHTML={{ __html: content?.body || 'Twoja bezpieczna przestrzeń do monitorowania zdrowia, emocji i relacji. Projekt stworzony z myślą o świadomym dbaniu o siebie i innych.' }} />
            </div>
          </motion.div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <FeatureCard icon={<BookOpen />} title="Dziennik" desc="Zapisuj myśli i śledź swój nastrój z pomocą AI." color="bg-emerald-500" />
        <FeatureCard icon={<Heart />} title="Randki" desc="Notuj wrażenia ze spotkań i dbaj o swoje granice." color="bg-rose-500" />
        <FeatureCard icon={<Activity />} title="Zdrowie" desc="Dbaj o bezpieczeństwo swoje i innych." color="bg-stone-900" />
      </div>

      {aboutContent && (
        <div className="bg-white p-12 rounded-[3rem] shadow-sm border border-stone-100">
          <h2 className="text-3xl font-bold mb-6 tracking-tight">{aboutContent.title}</h2>
          <div className="prose prose-stone prose-lg max-w-none text-stone-600" dangerouslySetInnerHTML={{ __html: aboutContent.body }} />
        </div>
      )}
    </motion.div>
  );
};

const FeatureCard: React.FC<{ icon: React.ReactNode, title: string, desc: string, color: string }> = ({ icon, title, desc, color }) => (
  <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-stone-100 hover:shadow-md transition-all">
    <div className={`w-12 h-12 ${color} text-white rounded-2xl flex items-center justify-center mb-6 shadow-lg`}>
      {React.cloneElement(icon as React.ReactElement, { className: 'w-6 h-6' })}
    </div>
    <h3 className="font-bold text-xl mb-2">{title}</h3>
    <p className="text-stone-500 text-sm leading-relaxed">{desc}</p>
  </div>
);

const LandingPage: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
  const [content, setContent] = useState<AdminContent | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'admin_content'), where('slug', '==', 'landing_page'), limit(1));
    return onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setContent({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as AdminContent);
      }
    });
  }, []);

  return (
    <div className="h-screen flex flex-col items-center justify-center px-6 text-center bg-stone-900 text-stone-50">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md"
      >
        <div className="mb-8 flex justify-center">
          <div className="p-4 bg-emerald-500 rounded-3xl shadow-lg shadow-emerald-500/20">
            <Activity className="w-12 h-12 text-white" />
          </div>
        </div>
        <h1 className="text-5xl font-bold mb-4 tracking-tight">{content?.title || 'Przyjazny Zakątek'}</h1>
        <div className="text-stone-400 mb-12 text-lg leading-relaxed prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: content?.body || 'Twój osobisty azyl dla zdrowia i relacji. Śledź swoje nastroje, randki i dbaj o bezpieczeństwo swoje oraz swoich bliskich w przyjaznej atmosferze.' }} />
        <button 
          onClick={onLogin}
          className="w-full py-4 px-8 bg-white text-stone-900 rounded-2xl font-semibold flex items-center justify-center gap-3 hover:bg-stone-100 transition-colors shadow-xl"
        >
          <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
          Zaloguj się przez Google
        </button>
      </motion.div>
    </div>
  );
};

const Header: React.FC<{ profile: UserProfile | null, onLogout: () => void, activeTab: string, setActiveTab: any, notifications: any[] }> = ({ profile, onLogout, activeTab, setActiveTab, notifications }) => (
  <header className="sticky top-0 z-40 bg-stone-50/80 backdrop-blur-md border-b border-stone-200 px-4 py-4 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-emerald-500/10">
        <Activity className="w-6 h-6" />
      </div>
      <div>
        <h2 className="font-bold text-lg leading-none">Przyjazny Zakątek</h2>
        <p className="text-xs text-stone-500 mt-1">Witaj, {profile?.displayName}</p>
      </div>
    </div>
    <div className="flex items-center gap-3">
      {notifications.length > 0 && (
        <div className="relative">
          <Bell className="w-6 h-6 text-red-500 animate-pulse" />
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
            {notifications.length}
          </span>
        </div>
      )}
      <button onClick={onLogout} className="p-2 text-stone-400 hover:text-stone-900 transition-colors">
        <LogOut className="w-6 h-6" />
      </button>
    </div>
  </header>
);

const BottomNav: React.FC<{ activeTab: string, setActiveTab: (t: any) => void, isAdmin: boolean }> = ({ activeTab, setActiveTab, isAdmin }) => (
  <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-stone-200 px-6 py-3 flex items-center justify-between max-w-4xl mx-auto shadow-2xl rounded-t-3xl">
    <NavButton icon={<Layout />} label="Start" active={activeTab === 'home'} onClick={() => setActiveTab('home')} />
    <NavButton icon={<BookOpen />} label="Dziennik" active={activeTab === 'journal'} onClick={() => setActiveTab('journal')} />
    <NavButton icon={<Heart />} label="Randki" active={activeTab === 'dates'} onClick={() => setActiveTab('dates')} />
    <NavButton icon={<Activity />} label="Spotkania" active={activeTab === 'sex'} onClick={() => setActiveTab('sex')} />
    {isAdmin && <NavButton icon={<Settings />} label="Admin" active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} />}
  </nav>
);

const NavButton: React.FC<{ icon: React.ReactNode, label: string, active: boolean, onClick: () => void }> = ({ icon, label, active, onClick }) => (
  <button 
    onClick={onClick}
    className={`flex flex-col items-center gap-1 transition-all ${active ? 'text-emerald-600 scale-110' : 'text-stone-400'}`}
  >
    {React.cloneElement(icon as React.ReactElement, { className: 'w-6 h-6' })}
    <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
  </button>
);

// --- Journal Tab ---

const JournalTab: React.FC<{ profile: UserProfile | null, analyzeMood: (t: string) => Promise<any> }> = ({ profile, analyzeMood }) => {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newEntry, setNewEntry] = useState<Partial<JournalEntry>>({
    date: format(new Date(), 'yyyy-MM-dd'),
    topic: '',
    content: ''
  });
  const [moodAlert, setMoodAlert] = useState<{ show: boolean, message: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [isStartingVideo, setIsStartingVideo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (isRecordingVideo && videoStream && videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = videoStream;
    }
  }, [isRecordingVideo, videoStream]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64data = reader.result as string;
          setNewEntry(prev => ({ ...prev, voiceNoteUrl: base64data }));
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error starting recording:", err);
      alert("Nie udało się uruchomić mikrofonu.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const startVideoRecording = async () => {
    if (isStartingVideo) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Twoja przeglądarka nie wspiera nagrywania wideo (brak getUserMedia).");
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      alert("Twoja przeglądarka nie wspiera nagrywania (brak MediaRecorder).");
      return;
    }
    
    setIsStartingVideo(true);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: true, 
          video: {
            width: { ideal: 480 },
            height: { ideal: 360 },
            frameRate: { ideal: 10 }
          } 
        });
      } catch (e) {
        console.warn("Failed with ideal constraints, trying simple ones", e);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      }

      setVideoStream(stream);
      setIsRecordingVideo(true);
      
      const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
        'video/quicktime'
      ];
      
      let selectedMimeType = '';
      for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          selectedMimeType = type;
          break;
        }
      }

      const options = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      videoRecorderRef.current = mediaRecorder;
      videoChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          videoChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (videoChunksRef.current.length === 0) {
          console.error("No video data recorded");
          return;
        }
        const videoBlob = new Blob(videoChunksRef.current, { type: selectedMimeType || 'video/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(videoBlob);
        reader.onloadend = () => {
          const base64data = reader.result as string;
          if (editingEntry) {
            setEditingEntry(prev => prev ? ({ ...prev, videoNoteUrl: base64data }) : null);
          } else {
            setNewEntry(prev => ({ ...prev, videoNoteUrl: base64data }));
          }
        };
        stream.getTracks().forEach(track => track.stop());
        setVideoStream(null);
        setIsRecordingVideo(false);
      };

      // Small delay to ensure stream is ready and preview is rendered
      await new Promise(resolve => setTimeout(resolve, 500));
      mediaRecorder.start(1000);
    } catch (err) {
      console.error("Error starting video recording:", err);
      setIsRecordingVideo(false);
      setVideoStream(null);
      const errorMsg = err instanceof Error ? err.name + ": " + err.message : "Nieznany błąd";
      alert("Błąd kamery: " + errorMsg + ". Upewnij się, że udzieliłeś uprawnień.");
    } finally {
      setIsStartingVideo(false);
    }
  };

  const stopVideoRecording = () => {
    if (videoRecorderRef.current && isRecordingVideo) {
      videoRecorderRef.current.stop();
      setIsRecordingVideo(false);
    }
  };

  useEffect(() => {
    if (!profile) return;
    const q = query(collection(db, 'journal'), where('userId', '==', profile.uid), orderBy('date', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setEntries(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as JournalEntry)));
    });
  }, [profile]);

  const handleSave = async () => {
    const entryToSave = editingEntry || newEntry;
    if (!profile) return;
    if (!entryToSave.content || entryToSave.content === '<p><br></p>') {
      alert('Wpis musi zawierać treść.');
      return;
    }
    
    setIsSaving(true);
    try {
      const mood = await analyzeMood(entryToSave.content);
      
      const entryData: any = {
        userId: profile.uid,
        date: entryToSave.date || format(new Date(), 'yyyy-MM-dd'),
        topic: entryToSave.topic || 'Bez tematu',
        content: entryToSave.content,
        moodScore: mood.moodScore,
        isDepressive: mood.isDepressive,
        voiceNoteUrl: entryToSave.voiceNoteUrl,
        videoNoteUrl: entryToSave.videoNoteUrl
      };

      // Check size (Firestore limit 1MB)
      const dataSize = JSON.stringify(entryData).length;
      if (dataSize > 1000000) {
        alert('Wpis jest zbyt duży (prawdopodobnie przez notatkę wideo lub głosową). Spróbuj nagrać krótszą notatkę.');
        setIsSaving(false);
        return;
      }

      if (editingEntry?.id) {
        await updateDoc(doc(db, 'journal', editingEntry.id), entryData);
        setEditingEntry(null);
      } else {
        await addDoc(collection(db, 'journal'), entryData);
        setIsAdding(false);
        setNewEntry({ date: format(new Date(), 'yyyy-MM-dd'), topic: '', content: '' });
      }

      if (mood.isDepressive || mood.moodScore <= 3) {
        setMoodAlert({
          show: true,
          message: "Zauważyliśmy, że Twój nastrój może być obniżony. Pamiętaj, że nie jesteś sam. Proszenie o pomoc to odwaga, nie wstyd."
        });
      }
    } catch (error) {
      console.error("Save error:", error);
      alert("Wystąpił błąd podczas zapisywania. Spróbuj ponownie.");
      handleFirestoreError(error, OperationType.WRITE, 'journal');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      try {
        await deleteDoc(doc(db, 'journal', deleteId));
        setDeleteId(null);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'journal');
      }
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <ConfirmModal 
        show={!!deleteId} 
        onConfirm={handleDelete} 
        onCancel={() => setDeleteId(null)}
        title="Usuń wpis"
        message="Czy na pewno chcesz usunąć ten wpis z dziennika? Tej operacji nie można cofnąć."
      />
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Dziennik</h1>
        <div className="flex gap-2">
          <button 
            onClick={() => setIsAdding(true)}
            className="p-3 bg-emerald-500 text-white rounded-2xl shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-colors"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      </div>

      {!isAdding && !editingEntry && (
        <button 
          onClick={() => setIsAdding(true)}
          className="w-full mb-8 p-8 bg-emerald-50 border-2 border-dashed border-emerald-200 rounded-[2rem] flex flex-col items-center justify-center gap-4 text-emerald-600 hover:bg-emerald-100 transition-all group"
        >
          <div className="p-4 bg-white rounded-2xl shadow-sm group-hover:scale-110 transition-transform">
            <Plus className="w-8 h-8" />
          </div>
          <span className="font-bold text-lg">Dodaj wpis do dziennika</span>
        </button>
      )}

      {isAdding || editingEntry ? (
        <div className="bg-white p-6 rounded-3xl shadow-xl border border-stone-100 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-bold text-xl">{editingEntry ? 'Edytuj wpis' : 'Nowy wpis'}</h2>
            <button onClick={() => { setIsAdding(false); setEditingEntry(null); }} className="text-stone-400 hover:text-stone-900">
              <XCircle className="w-6 h-6" />
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Data</label>
              <input 
                type="date" 
                value={editingEntry ? editingEntry.date : newEntry.date}
                onChange={e => editingEntry ? setEditingEntry({ ...editingEntry, date: e.target.value }) : setNewEntry({ ...newEntry, date: e.target.value })}
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Temat</label>
              <input 
                type="text" 
                placeholder="O czym dzisiaj myślisz?"
                value={editingEntry ? editingEntry.topic : newEntry.topic}
                onChange={e => editingEntry ? setEditingEntry({ ...editingEntry, topic: e.target.value }) : setNewEntry({ ...newEntry, topic: e.target.value })}
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Treść</label>
              <div className="bg-stone-50 rounded-xl overflow-hidden border border-stone-200">
                <ReactQuill 
                  theme="snow" 
                  value={editingEntry ? editingEntry.content : newEntry.content} 
                  onChange={val => editingEntry ? setEditingEntry({ ...editingEntry, content: val }) : setNewEntry({ ...newEntry, content: val })}
                  className="h-64"
                />
              </div>
            </div>
            <div className="pt-12 space-y-6">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Notatka głosowa</label>
                {(editingEntry ? editingEntry.voiceNoteUrl : newEntry.voiceNoteUrl) ? (
                  <div className="flex items-center gap-4 p-4 bg-stone-50 rounded-2xl border border-stone-100">
                    <audio src={editingEntry ? editingEntry.voiceNoteUrl : newEntry.voiceNoteUrl} controls className="flex-1 h-8" />
                    <button 
                      onClick={() => editingEntry ? setEditingEntry({ ...editingEntry, voiceNoteUrl: undefined }) : setNewEntry({ ...newEntry, voiceNoteUrl: undefined })}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                  >
                    <Mic className="w-6 h-6" />
                    {isRecording ? 'Zatrzymaj nagrywanie' : 'Nagraj notatkę głosową'}
                  </button>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold uppercase tracking-widest text-stone-400">Notatka wideo</label>
                  {(editingEntry ? editingEntry.videoNoteUrl : newEntry.videoNoteUrl) && (
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Wideo dodane
                    </span>
                  )}
                </div>
                {(editingEntry ? editingEntry.videoNoteUrl : newEntry.videoNoteUrl) ? (
                  <div className="space-y-2">
                    <video src={editingEntry ? editingEntry.videoNoteUrl : newEntry.videoNoteUrl} controls className="w-full rounded-2xl border border-stone-100" />
                    <button 
                      onClick={() => editingEntry ? setEditingEntry({ ...editingEntry, videoNoteUrl: undefined }) : setNewEntry({ ...newEntry, videoNoteUrl: undefined })}
                      className="w-full py-3 bg-red-50 text-red-500 font-bold text-xs uppercase tracking-widest hover:bg-red-100 rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Usuń i nagraj ponownie
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {isRecordingVideo && (
                      <video ref={videoPreviewRef} autoPlay muted playsInline className="w-full rounded-2xl bg-black aspect-video object-cover" />
                    )}
                    <button 
                      onClick={isRecordingVideo ? stopVideoRecording : startVideoRecording}
                      disabled={isStartingVideo}
                      className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${isRecordingVideo ? 'bg-red-500 text-white animate-pulse' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'} ${isStartingVideo ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <Video className="w-6 h-6" />
                      {isStartingVideo ? 'Uruchamianie...' : (isRecordingVideo ? 'Zatrzymaj nagrywanie wideo' : 'Nagraj notatkę wideo')}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className={`w-full py-4 bg-emerald-500 text-white rounded-2xl font-bold shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all mt-4 ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Save className="w-5 h-5 inline-block mr-2" />
              {isSaving ? 'Zapisywanie...' : (editingEntry ? 'Zapisz zmiany' : 'Zapisz wpis')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map(entry => (
            <div key={entry.id} className="bg-white p-6 rounded-3xl shadow-sm border border-stone-100 hover:shadow-md transition-shadow relative group">
              <div className="absolute top-6 right-6 flex gap-2 z-10">
                <button 
                  onClick={() => setEditingEntry(entry)}
                  className="p-2 bg-stone-100 text-stone-600 rounded-lg hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setDeleteId(entry.id)}
                  className="p-2 bg-stone-100 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">{entry.date}</span>
                {entry.moodScore && (
                  <div className={`w-3 h-3 rounded-full ${entry.moodScore > 7 ? 'bg-emerald-500' : entry.moodScore > 4 ? 'bg-amber-500' : 'bg-red-500'}`} />
                )}
              </div>
              <h3 className="font-bold text-xl mb-2">{entry.topic}</h3>
              <div className="text-stone-600 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: entry.content }} />
              {entry.voiceNoteUrl && (
                <div className="mt-4 p-3 bg-stone-50 rounded-xl">
                  <p className="text-[10px] font-bold text-stone-400 uppercase mb-2">Notatka głosowa</p>
                  <audio src={entry.voiceNoteUrl} controls className="w-full h-8" />
                </div>
              )}
              {entry.videoNoteUrl && (
                <div className="mt-4 p-3 bg-stone-50 rounded-xl">
                  <p className="text-[10px] font-bold text-stone-400 uppercase mb-2">Notatka wideo</p>
                  <video src={entry.videoNoteUrl} controls className="w-full rounded-lg" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {moodAlert && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-stone-900/50 backdrop-blur-sm">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white p-8 rounded-[2rem] max-w-md w-full shadow-2xl border-4 border-red-100"
          >
            <div className="flex justify-center mb-6">
              <div className="p-4 bg-red-100 rounded-full">
                <ShieldAlert className="w-12 h-12 text-red-500" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-center mb-4">Wsparcie dla Ciebie</h2>
            <p className="text-stone-600 text-center mb-8 leading-relaxed">
              {moodAlert.message}
            </p>
            <div className="space-y-4">
              <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                <h4 className="font-bold text-sm mb-2 uppercase tracking-wider text-stone-400">Gdzie szukać pomocy?</h4>
                <p className="font-bold text-lg">116 123</p>
                <p className="text-xs text-stone-500">Kryzysowy Telefon Zaufania dla Dorosłych</p>
              </div>
              <button 
                onClick={() => setMoodAlert(null)}
                className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold"
              >
                Rozumiem, dziękuję
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};

// --- Dates Tab ---

const DatesTab: React.FC<{ profile: UserProfile | null }> = ({ profile }) => {
  const [dates, setDates] = useState<DateLog[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingDate, setEditingDate] = useState<DateLog | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState<Partial<DateLog>>({
    partnerName: '',
    moodBefore: 5,
    moodAfter: 5,
    sexOccurred: false,
    likes: '',
    dislikes: '',
    redFlags: ''
  });
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64data = reader.result as string;
          setNewDate(prev => ({ ...prev, audioNoteUrl: base64data }));
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error starting recording:", err);
      alert("Nie udało się uruchomić mikrofonu.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  useEffect(() => {
    if (!profile) return;
    const q = query(collection(db, 'dates'), where('userId', '==', profile.uid), orderBy('timestamp', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setDates(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DateLog)));
    });
  }, [profile]);

  const handleSave = async () => {
    const dateToSave = editingDate || newDate;
    if (!profile) return;
    if (!dateToSave.partnerName) {
      alert('Podaj imię partnera.');
      return;
    }
    
    setIsSaving(true);
    try {
      const log: any = {
        userId: profile.uid,
        partnerName: dateToSave.partnerName,
        contact: dateToSave.contact || '',
        moodBefore: dateToSave.moodBefore,
        moodAfter: dateToSave.moodAfter,
        sexOccurred: !!dateToSave.sexOccurred,
        likes: dateToSave.likes || '',
        dislikes: dateToSave.dislikes || '',
        redFlags: dateToSave.redFlags || '',
        wantToMeetAgain: dateToSave.wantToMeetAgain,
        location: dateToSave.location || '',
        audioNoteUrl: dateToSave.audioNoteUrl || null,
        timestamp: dateToSave.timestamp || new Date().toISOString()
      };

      // Check size (Firestore limit 1MB)
      const dataSize = JSON.stringify(log).length;
      if (dataSize > 1000000) {
        alert('Wpis jest zbyt duży. Spróbuj nagrać krótszą notatkę głosową.');
        setIsSaving(false);
        return;
      }

      if (editingDate?.id) {
        await updateDoc(doc(db, 'dates', editingDate.id), log);
        setEditingDate(null);
      } else {
        await addDoc(collection(db, 'dates'), log);
        setIsAdding(false);
        setNewDate({ partnerName: '', moodBefore: 5, moodAfter: 5, sexOccurred: false });
      }
    } catch (error) {
      console.error("Save error:", error);
      alert("Wystąpił błąd podczas zapisywania. Spróbuj ponownie.");
      handleFirestoreError(error, OperationType.WRITE, 'dates');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      try {
        await deleteDoc(doc(db, 'dates', deleteId));
        setDeleteId(null);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'dates');
      }
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <ConfirmModal 
        show={!!deleteId} 
        onConfirm={handleDelete} 
        onCancel={() => setDeleteId(null)}
        title="Usuń randkę"
        message="Czy na pewno chcesz usunąć ten wpis o randce? Tej operacji nie można cofnąć."
      />
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Randki</h1>
        <button 
          onClick={() => setIsAdding(true)}
          className="p-3 bg-rose-500 text-white rounded-2xl shadow-lg shadow-rose-500/20 hover:bg-rose-600 transition-colors"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

      {!isAdding && !editingDate && (
        <button 
          onClick={() => setIsAdding(true)}
          className="w-full mb-8 p-8 bg-rose-50 border-2 border-dashed border-rose-200 rounded-[2rem] flex flex-col items-center justify-center gap-4 text-rose-600 hover:bg-rose-100 transition-all group"
        >
          <div className="p-4 bg-white rounded-2xl shadow-sm group-hover:scale-110 transition-transform">
            <Plus className="w-8 h-8" />
          </div>
          <span className="font-bold text-lg">Dodaj wrażenia z randki</span>
        </button>
      )}

      {isAdding || editingDate ? (
        <div className="bg-white p-6 rounded-3xl shadow-xl border border-stone-100 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-bold text-xl">{editingDate ? 'Edytuj randkę' : 'Nowa randka'}</h2>
            <button onClick={() => { setIsAdding(false); setEditingDate(null); }} className="text-stone-400 hover:text-stone-900">
              <XCircle className="w-6 h-6" />
            </button>
          </div>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Z kim?</label>
                <input 
                  type="text" 
                  value={editingDate ? editingDate.partnerName : newDate.partnerName}
                  onChange={e => editingDate ? setEditingDate({ ...editingDate, partnerName: e.target.value }) : setNewDate({ ...newDate, partnerName: e.target.value })}
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Kontakt</label>
                <input 
                  type="text" 
                  value={editingDate ? editingDate.contact : newDate.contact}
                  onChange={e => editingDate ? setEditingDate({ ...editingDate, contact: e.target.value }) : setNewDate({ ...newDate, contact: e.target.value })}
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Nastrój przed (1-10)</label>
                <input 
                  type="range" min="1" max="10"
                  value={editingDate ? editingDate.moodBefore : newDate.moodBefore}
                  onChange={e => editingDate ? setEditingDate({ ...editingDate, moodBefore: parseInt(e.target.value) }) : setNewDate({ ...newDate, moodBefore: parseInt(e.target.value) })}
                  className="w-full accent-rose-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Nastrój po (1-10)</label>
                <input 
                  type="range" min="1" max="10"
                  value={editingDate ? editingDate.moodAfter : newDate.moodAfter}
                  onChange={e => editingDate ? setEditingDate({ ...editingDate, moodAfter: parseInt(e.target.value) }) : setNewDate({ ...newDate, moodAfter: parseInt(e.target.value) })}
                  className="w-full accent-rose-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-stone-50 rounded-2xl border border-stone-100">
              <input 
                type="checkbox" 
                checked={editingDate ? editingDate.sexOccurred : newDate.sexOccurred}
                onChange={e => editingDate ? setEditingDate({ ...editingDate, sexOccurred: e.target.checked }) : setNewDate({ ...newDate, sexOccurred: e.target.checked })}
                className="w-5 h-5 accent-rose-500"
              />
              <label className="font-bold text-stone-700">Czy był seks?</label>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Co mi się podobało?</label>
                <div className="bg-stone-50 rounded-xl overflow-hidden border border-stone-200">
                  <ReactQuill 
                    theme="snow" 
                    value={editingDate ? editingDate.likes : newDate.likes} 
                    onChange={val => editingDate ? setEditingDate({ ...editingDate, likes: val }) : setNewDate({ ...newDate, likes: val })}
                    className="h-32"
                  />
                </div>
              </div>
              <div className="pt-8">
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Co mi się NIE podobało?</label>
                <div className="bg-stone-50 rounded-xl overflow-hidden border border-stone-200">
                  <ReactQuill 
                    theme="snow" 
                    value={editingDate ? editingDate.dislikes : newDate.dislikes} 
                    onChange={val => editingDate ? setEditingDate({ ...editingDate, dislikes: val }) : setNewDate({ ...newDate, dislikes: val })}
                    className="h-32"
                  />
                </div>
              </div>
              <div className="pt-8">
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Red flagi</label>
                <div className="bg-stone-50 rounded-xl overflow-hidden border border-stone-200">
                  <ReactQuill 
                    theme="snow" 
                    value={editingDate ? editingDate.redFlags : newDate.redFlags} 
                    onChange={val => editingDate ? setEditingDate({ ...editingDate, redFlags: val }) : setNewDate({ ...newDate, redFlags: val })}
                    className="h-32"
                  />
                </div>
              </div>
            </div>

            <div className="pt-8">
              <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Notatka głosowa</label>
              {(editingDate ? editingDate.audioNoteUrl : newDate.audioNoteUrl) ? (
                <div className="flex items-center gap-4 p-4 bg-stone-50 rounded-2xl border border-stone-100">
                  <audio src={editingDate ? editingDate.audioNoteUrl : newDate.audioNoteUrl} controls className="flex-1 h-8" />
                  <button 
                    onClick={() => editingDate ? setEditingDate({ ...editingDate, audioNoteUrl: undefined }) : setNewDate({ ...newDate, audioNoteUrl: undefined })}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                >
                  <Mic className="w-6 h-6" />
                  {isRecording ? 'Zatrzymaj nagrywanie' : 'Nagraj notatkę głosową'}
                </button>
              )}
            </div>

            <button 
              onClick={handleSave}
              disabled={isSaving}
              className={`w-full py-4 bg-rose-500 text-white rounded-2xl font-bold shadow-lg shadow-rose-500/20 hover:bg-rose-600 transition-all mt-8 ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Save className="w-5 h-5 inline-block mr-2" />
              {isSaving ? 'Zapisywanie...' : (editingDate ? 'Zapisz zmiany' : 'Zapisz randkę')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {dates.map(date => (
            <div key={date.id} className="bg-white p-6 rounded-3xl shadow-sm border border-stone-100 relative group">
              <div className="absolute top-6 right-6 flex gap-2 z-10">
                <button 
                  onClick={() => setEditingDate(date)}
                  className="p-2 bg-stone-100 text-stone-600 rounded-lg hover:bg-rose-50 hover:text-rose-600 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setDeleteId(date.id)}
                  className="p-2 bg-stone-100 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center text-rose-500">
                    <Heart className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{date.partnerName}</h3>
                    <p className="text-xs text-stone-400">{format(parseISO(date.timestamp), 'dd.MM.yyyy HH:mm')}</p>
                  </div>
                </div>
                {date.sexOccurred && (
                  <div className="px-3 py-1 bg-rose-50 text-rose-600 rounded-full text-[10px] font-bold uppercase tracking-widest">
                    Seks
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-stone-50 p-3 rounded-xl">
                  <p className="text-[10px] font-bold text-stone-400 uppercase mb-1">Nastrój</p>
                  <p className="font-bold">{date.moodBefore} → {date.moodAfter}</p>
                </div>
                <div className="bg-stone-50 p-3 rounded-xl">
                  <p className="text-[10px] font-bold text-stone-400 uppercase mb-1">Lokalizacja</p>
                  <p className="font-bold">{date.location || 'Brak'}</p>
                </div>
              </div>
              {date.audioNoteUrl && (
                <div className="mt-4 p-3 bg-stone-50 rounded-xl">
                  <p className="text-[10px] font-bold text-stone-400 uppercase mb-2">Notatka głosowa</p>
                  <audio src={date.audioNoteUrl} controls className="w-full h-8" />
                </div>
              )}
              <div className="mt-4 space-y-3">
                {date.likes && (
                  <div>
                    <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Podobało mi się</p>
                    <div className="text-xs prose prose-sm" dangerouslySetInnerHTML={{ __html: date.likes }} />
                  </div>
                )}
                {date.dislikes && (
                  <div>
                    <p className="text-[10px] font-bold text-rose-600 uppercase mb-1">Nie podobało mi się</p>
                    <div className="text-xs prose prose-sm" dangerouslySetInnerHTML={{ __html: date.dislikes }} />
                  </div>
                )}
                {date.redFlags && (
                  <div>
                    <p className="text-[10px] font-bold text-red-600 uppercase mb-1">Red flagi</p>
                    <div className="text-xs prose prose-sm font-bold" dangerouslySetInnerHTML={{ __html: date.redFlags }} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
};

// --- Sex Tab ---

const SexTab: React.FC<{ profile: UserProfile | null }> = ({ profile }) => {
  const [encounters, setEncounters] = useState<SexEncounter[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingEncounter, setEditingEncounter] = useState<SexEncounter | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [newEncounter, setNewEncounter] = useState<Partial<SexEncounter>>({
    partnerName: '',
    timestamp: format(new Date(), 'yyyy-MM-dd'),
    sexType: [],
    protection: [],
    chemsex: false,
    moodScore: 5,
    hasConcerns: false,
    concernLocation: 'me',
    symptoms: [],
    wantToMeetAgain: true,
    afterFeelings: ''
  });
  const [showQr, setShowQr] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [customDays, setCustomDays] = useState(7);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    if (!profile) return;
    const q = query(collection(db, 'sex_encounters'), where('userId', '==', profile.uid), orderBy('timestamp', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setEncounters(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SexEncounter)));
    });
  }, [profile]);

  const startScanner = () => {
    setIsScanning(true);
    setTimeout(() => {
      scannerRef.current = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 }, false);
      scannerRef.current.render((decodedText) => {
        try {
          const data = JSON.parse(decodedText);
          if (editingEncounter) {
            setEditingEncounter({
              ...editingEncounter,
              partnerId: data.uid,
              partnerName: data.displayName
            });
          } else {
            setNewEncounter({
              ...newEncounter,
              partnerId: data.uid,
              partnerName: data.displayName
            });
          }
          setIsScanning(false);
          scannerRef.current?.clear();
          if (!editingEncounter) setIsAdding(true);
        } catch (e) {
          alert("Nieprawidłowy kod QR");
        }
      }, (error) => {});
    }, 100);
  };

  const handleSave = async () => {
    const encounterToSave = editingEncounter || newEncounter;
    if (!profile) return;
    
    setIsSaving(true);
    const encounterData: any = {
      userId: profile.uid,
      partnerName: encounterToSave.partnerName || 'Anonimowy partner',
      partnerId: encounterToSave.partnerId || null,
      timestamp: encounterToSave.timestamp || format(new Date(), 'yyyy-MM-dd'),
      sexType: encounterToSave.sexType || [],
      sexTypeOther: encounterToSave.sexTypeOther || '',
      protection: encounterToSave.protection || [],
      protectionOther: encounterToSave.protectionOther || '',
      chemsex: !!encounterToSave.chemsex,
      moodScore: encounterToSave.moodScore || 5,
      hasConcerns: !!encounterToSave.hasConcerns,
      concernLocation: encounterToSave.concernLocation || 'me',
      symptoms: encounterToSave.symptoms || [],
      symptomsOther: encounterToSave.symptomsOther || '',
      wantToMeetAgain: !!encounterToSave.wantToMeetAgain,
      afterFeelings: encounterToSave.afterFeelings || ''
    };

    // Check size (Firestore limit 1MB)
    const dataSize = JSON.stringify(encounterData).length;
    if (dataSize > 1000000) {
      alert('Wpis jest zbyt duży. Spróbuj skrócić opis uczuć.');
      setIsSaving(false);
      return;
    }

    try {
      if (editingEncounter?.id) {
        await updateDoc(doc(db, 'sex_encounters', editingEncounter.id), encounterData);
        setEditingEncounter(null);
      } else {
        await addDoc(collection(db, 'sex_encounters'), encounterData);
        setIsAdding(false);
        setNewEncounter({
          partnerName: '',
          timestamp: format(new Date(), 'yyyy-MM-dd'),
          sexType: [],
          protection: [],
          chemsex: false,
          moodScore: 5,
          hasConcerns: false,
          concernLocation: 'me',
          symptoms: [],
          wantToMeetAgain: true,
          afterFeelings: ''
        });
      }
    } catch (error) {
      console.error("Save error:", error);
      alert("Wystąpił błąd podczas zapisywania. Spróbuj ponownie.");
      handleFirestoreError(error, OperationType.WRITE, 'sex_encounters');
    } finally {
      setIsSaving(false);
    }
  };

  const notifyPartners = async (days: number) => {
    if (!profile) return;
    const threshold = format(subDays(new Date(), days), 'yyyy-MM-dd');
    const recentEncounters = encounters.filter(e => e.timestamp >= threshold && e.partnerId);
    
    for (const e of recentEncounters) {
      await addDoc(collection(db, 'notifications'), {
        fromUserId: profile.uid,
        toUserId: e.partnerId,
        encounterDate: e.timestamp,
        timestamp: new Date().toISOString(),
        read: false
      });
    }
    alert(`Wysłano powiadomienia do ${recentEncounters.length} partnerów.`);
  };

  const handleDelete = async () => {
    if (deleteId) {
      try {
        await deleteDoc(doc(db, 'sex_encounters', deleteId));
        setDeleteId(null);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'sex_encounters');
      }
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <ConfirmModal 
        show={!!deleteId} 
        onConfirm={handleDelete} 
        onCancel={() => setDeleteId(null)}
        title="Usuń spotkanie"
        message="Czy na pewno chcesz usunąć ten wpis o spotkaniu intymnym? Tej operacji nie można cofnąć."
      />
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Spotkania intymne</h1>
        <div className="flex gap-2">
          <button 
            onClick={() => setShowReminders(true)}
            className="p-3 bg-stone-100 text-stone-600 rounded-2xl shadow-sm"
            title="Przypomnienia o badaniach"
          >
            <Bell className="w-6 h-6" />
          </button>
          <button 
            onClick={() => setShowQr(true)}
            className="p-3 bg-stone-900 text-white rounded-2xl shadow-lg"
          >
            <QrCode className="w-6 h-6" />
          </button>
          <button 
            onClick={startScanner}
            className="p-3 bg-emerald-500 text-white rounded-2xl shadow-lg"
          >
            <Scan className="w-6 h-6" />
          </button>
          <button 
            onClick={() => setIsAdding(true)}
            className="p-3 bg-emerald-500 text-white rounded-2xl shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-colors"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      </div>

      {!isAdding && !editingEncounter && (
        <button 
          onClick={() => setIsAdding(true)}
          className="w-full mb-8 p-8 bg-emerald-50 border-2 border-dashed border-emerald-200 rounded-[2rem] flex flex-col items-center justify-center gap-4 text-emerald-600 hover:bg-emerald-100 transition-all group"
        >
          <div className="p-4 bg-white rounded-2xl shadow-sm group-hover:scale-110 transition-transform">
            <Plus className="w-8 h-8" />
          </div>
          <span className="font-bold text-lg">Dodaj informacje o spotkaniu</span>
        </button>
      )}

      {isScanning && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-6">
          <div id="reader" className="w-full max-w-md bg-white rounded-3xl overflow-hidden"></div>
          <button 
            onClick={() => { setIsScanning(false); scannerRef.current?.clear(); }}
            className="mt-8 py-4 px-8 bg-white text-black rounded-2xl font-bold"
          >
            Anuluj
          </button>
        </div>
      )}

      {showQr && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-stone-900/50 backdrop-blur-sm">
          <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="bg-white p-8 rounded-[2rem] max-w-sm w-full text-center">
            <h2 className="text-2xl font-bold mb-2">Twój Kod QR</h2>
            <p className="text-stone-500 mb-8 text-sm">Udostępnij partnerowi, aby szybko zapisać spotkanie.</p>
            <div className="flex justify-center mb-8 p-4 bg-stone-50 rounded-3xl">
              <QRCodeSVG value={JSON.stringify({
                uid: profile?.uid,
                displayName: profile?.displayName,
                prepStatus: profile?.prepStatus,
                lastHivTest: profile?.lastHivTest,
                lastSyphilisTest: profile?.lastSyphilisTest
              })} size={200} />
            </div>
            <div className="bg-emerald-50 p-4 rounded-2xl mb-8">
              <p className="text-xs font-bold text-emerald-600 uppercase mb-1">Twój numer</p>
              <p className="text-2xl font-bold tracking-widest">{profile?.individualNumber}</p>
            </div>
            <button onClick={() => setShowQr(false)} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold">Zamknij</button>
          </motion.div>
        </div>
      )}

      {showReminders && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-stone-900/50 backdrop-blur-sm">
          <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="bg-white p-8 rounded-[2rem] max-w-md w-full">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Przypomnienia</h2>
              <button onClick={() => setShowReminders(false)} className="text-stone-400 hover:text-stone-900">
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-6">
              <ReminderItem 
                label="Badanie HIV" 
                lastTest={profile?.lastHivTest} 
                interval={profile?.hivTestIntervalMonths} 
                nextTest={profile?.nextHivTestDate}
                onUpdate={async (date, interval) => {
                  if (!profile) return;
                  const next = date ? format(addMonths(parseISO(date), interval), 'yyyy-MM-dd') : null;
                  await updateDoc(doc(db, 'users', profile.uid), {
                    lastHivTest: date,
                    hivTestIntervalMonths: interval,
                    nextHivTestDate: next
                  });
                }}
              />
              <ReminderItem 
                label="Badanie Kiły" 
                lastTest={profile?.lastSyphilisTest} 
                interval={profile?.syphilisTestIntervalMonths} 
                nextTest={profile?.nextSyphilisTestDate}
                onUpdate={async (date, interval) => {
                  if (!profile) return;
                  const next = date ? format(addMonths(parseISO(date), interval), 'yyyy-MM-dd') : null;
                  await updateDoc(doc(db, 'users', profile.uid), {
                    lastSyphilisTest: date,
                    syphilisTestIntervalMonths: interval,
                    nextSyphilisTestDate: next
                  });
                }}
              />
            </div>
            <button onClick={() => setShowReminders(false)} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold mt-8">Gotowe</button>
          </motion.div>
        </div>
      )}

      {isAdding || editingEncounter ? (
        <div className="bg-white p-6 rounded-3xl shadow-xl border border-stone-100 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-bold text-xl">{editingEncounter ? 'Edytuj zbliżenie' : 'Zapisz zbliżenie'}</h2>
            <button onClick={() => { setIsAdding(false); setEditingEncounter(null); }} className="text-stone-400 hover:text-stone-900">
              <XCircle className="w-6 h-6" />
            </button>
          </div>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Data</label>
                <input 
                  type="date" 
                  value={editingEncounter ? editingEncounter.timestamp : newEncounter.timestamp}
                  onChange={e => editingEncounter ? setEditingEncounter({ ...editingEncounter, timestamp: e.target.value }) : setNewEncounter({ ...newEncounter, timestamp: e.target.value })}
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Partner</label>
                <input 
                  type="text" 
                  value={editingEncounter ? editingEncounter.partnerName : newEncounter.partnerName}
                  onChange={e => editingEncounter ? setEditingEncounter({ ...editingEncounter, partnerName: e.target.value }) : setNewEncounter({ ...newEncounter, partnerName: e.target.value })}
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none"
                  placeholder="Imię"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Rodzaj seksu (możesz wybrać kilka)</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'vaginal', label: 'Waginalny' },
                  { id: 'anal', label: 'Analny' },
                  { id: 'oral', label: 'Oralny' },
                  { id: 'other', label: 'Inny' }
                ].map(type => (
                  <button 
                    key={type.id}
                    onClick={() => {
                      const current = (editingEncounter ? editingEncounter.sexType : newEncounter.sexType) || [];
                      const updated = current.includes(type.id) ? current.filter(x => x !== type.id) : [...current, type.id];
                      editingEncounter ? setEditingEncounter({ ...editingEncounter, sexType: updated }) : setNewEncounter({ ...newEncounter, sexType: updated });
                    }}
                    className={`p-3 text-sm rounded-xl border transition-all text-left flex items-center justify-between ${(editingEncounter ? editingEncounter.sexType : newEncounter.sexType)?.includes(type.id) ? 'bg-emerald-50 border-emerald-200 text-emerald-600 font-bold' : 'bg-stone-50 border-stone-200 text-stone-500'}`}
                  >
                    {type.label}
                    {(editingEncounter ? editingEncounter.sexType : newEncounter.sexType)?.includes(type.id) && <CheckCircle2 className="w-4 h-4" />}
                  </button>
                ))}
              </div>
              {(editingEncounter ? editingEncounter.sexType : newEncounter.sexType)?.includes('other') && (
                <input 
                  type="text" 
                  value={editingEncounter ? editingEncounter.sexTypeOther : newEncounter.sexTypeOther}
                  onChange={e => editingEncounter ? setEditingEncounter({ ...editingEncounter, sexTypeOther: e.target.value }) : setNewEncounter({ ...newEncounter, sexTypeOther: e.target.value })}
                  className="w-full mt-2 p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none"
                  placeholder="Jaki inny?"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Zabezpieczenie (możesz wybrać kilka)</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'condom', label: 'Prezerwatywa' },
                  { id: 'prep', label: 'PrEP' },
                  { id: 'other', label: 'Inne' },
                  { id: 'none', label: 'Bez zabezpieczenia' }
                ].map(prot => (
                  <button 
                    key={prot.id}
                    onClick={() => {
                      const current = (editingEncounter ? editingEncounter.protection : newEncounter.protection) || [];
                      const updated = current.includes(prot.id) ? current.filter(x => x !== prot.id) : [...current, prot.id];
                      editingEncounter ? setEditingEncounter({ ...editingEncounter, protection: updated }) : setNewEncounter({ ...newEncounter, protection: updated });
                    }}
                    className={`p-3 text-sm rounded-xl border transition-all text-left flex items-center justify-between ${(editingEncounter ? editingEncounter.protection : newEncounter.protection)?.includes(prot.id) ? 'bg-emerald-50 border-emerald-200 text-emerald-600 font-bold' : 'bg-stone-50 border-stone-200 text-stone-500'}`}
                  >
                    {prot.label}
                    {(editingEncounter ? editingEncounter.protection : newEncounter.protection)?.includes(prot.id) && <CheckCircle2 className="w-4 h-4" />}
                  </button>
                ))}
              </div>
              {(editingEncounter ? editingEncounter.protection : newEncounter.protection)?.includes('other') && (
                <input 
                  type="text" 
                  value={editingEncounter ? editingEncounter.protectionOther : newEncounter.protectionOther}
                  onChange={e => editingEncounter ? setEditingEncounter({ ...editingEncounter, protectionOther: e.target.value }) : setNewEncounter({ ...newEncounter, protectionOther: e.target.value })}
                  className="w-full mt-2 p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none"
                  placeholder="Jaka inna forma?"
                />
              )}
            </div>

            <div className="flex items-center gap-3 p-4 bg-stone-50 rounded-2xl">
              <input 
                type="checkbox" 
                checked={editingEncounter ? editingEncounter.chemsex : newEncounter.chemsex}
                onChange={e => editingEncounter ? setEditingEncounter({ ...editingEncounter, chemsex: e.target.checked }) : setNewEncounter({ ...newEncounter, chemsex: e.target.checked })}
                className="w-5 h-5 accent-emerald-500"
              />
              <label className="font-bold text-stone-700">Chemsex?</label>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Doznania (1-10)</label>
              <div className="flex items-center gap-4">
                <input 
                  type="range" min="1" max="10" 
                  value={editingEncounter ? editingEncounter.moodScore : newEncounter.moodScore}
                  onChange={e => editingEncounter ? setEditingEncounter({ ...editingEncounter, moodScore: parseInt(e.target.value) }) : setNewEncounter({ ...newEncounter, moodScore: parseInt(e.target.value) })}
                  className="flex-1 accent-emerald-500"
                />
                <span className="text-xl font-bold text-emerald-600 w-8">{editingEncounter ? editingEncounter.moodScore : newEncounter.moodScore}</span>
              </div>
            </div>

            <div className="space-y-4">
              <button 
                onClick={() => editingEncounter ? setEditingEncounter({ ...editingEncounter, hasConcerns: !editingEncounter.hasConcerns }) : setNewEncounter({ ...newEncounter, hasConcerns: !newEncounter.hasConcerns })}
                className={`w-full p-4 rounded-2xl font-bold flex items-center justify-between transition-all border-2 ${(editingEncounter ? editingEncounter.hasConcerns : newEncounter.hasConcerns) ? 'bg-red-50 border-red-200 text-red-600' : 'bg-stone-50 border-stone-100 text-stone-700'}`}
              >
                <div className="flex items-center gap-3">
                  <ShieldAlert className="w-6 h-6" />
                  <span>Czy coś Cię zaniepokoiło?</span>
                </div>
                {(editingEncounter ? editingEncounter.hasConcerns : newEncounter.hasConcerns) ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6 text-stone-300" />}
              </button>

              {(editingEncounter ? editingEncounter.hasConcerns : newEncounter.hasConcerns) && (
                <div className="space-y-4 pl-4 border-l-2 border-red-100">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">U kogo?</label>
                    <div className="flex gap-2">
                      {['me', 'partner', 'both'].map(loc => (
                        <button 
                          key={loc}
                          onClick={() => editingEncounter ? setEditingEncounter({ ...editingEncounter, concernLocation: loc as any }) : setNewEncounter({ ...newEncounter, concernLocation: loc as any })}
                          className={`flex-1 py-2 text-xs rounded-lg border transition-all ${(editingEncounter ? editingEncounter.concernLocation : newEncounter.concernLocation) === loc ? 'bg-red-50 border-red-200 text-red-600 font-bold' : 'bg-white border-stone-200 text-stone-500'}`}
                        >
                          {loc === 'me' ? 'U mnie' : loc === 'partner' ? 'U partnera' : 'U obu'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Co to było?</label>
                    <div className="grid grid-cols-2 gap-2">
                      {['Wyciek z cewki', 'Zmiany skórne', 'Ból', 'Podrażnienie', 'Inne'].map(s => (
                        <button 
                          key={s}
                          onClick={() => {
                            const current = (editingEncounter ? editingEncounter.symptoms : newEncounter.symptoms) || [];
                            const updated = current.includes(s) ? current.filter(x => x !== s) : [...current, s];
                            editingEncounter ? setEditingEncounter({ ...editingEncounter, symptoms: updated }) : setNewEncounter({ ...newEncounter, symptoms: updated });
                          }}
                          className={`p-2 text-xs rounded-lg border transition-all ${(editingEncounter ? editingEncounter.symptoms : newEncounter.symptoms)?.includes(s) ? 'bg-red-50 border-red-200 text-red-600 font-bold' : 'bg-white border-stone-200 text-stone-500'}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    {(editingEncounter ? editingEncounter.symptoms : newEncounter.symptoms)?.includes('Inne') && (
                      <input 
                        type="text" 
                        value={editingEncounter ? editingEncounter.symptomsOther : newEncounter.symptomsOther}
                        onChange={e => editingEncounter ? setEditingEncounter({ ...editingEncounter, symptomsOther: e.target.value }) : setNewEncounter({ ...newEncounter, symptomsOther: e.target.value })}
                        className="w-full mt-2 p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none text-sm"
                        placeholder="Opisz co to było..."
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 p-4 bg-stone-50 rounded-2xl">
              <input 
                type="checkbox" 
                checked={editingEncounter ? editingEncounter.wantToMeetAgain : newEncounter.wantToMeetAgain}
                onChange={e => editingEncounter ? setEditingEncounter({ ...editingEncounter, wantToMeetAgain: e.target.checked }) : setNewEncounter({ ...newEncounter, wantToMeetAgain: e.target.checked })}
                className="w-5 h-5 accent-emerald-500"
              />
              <label className="font-bold text-stone-700">Czy chcesz się jeszcze spotkać?</label>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">Twoje odczucia</label>
              <div className="bg-stone-50 rounded-xl overflow-hidden border border-stone-200">
                <ReactQuill 
                  theme="snow" 
                  value={editingEncounter ? editingEncounter.afterFeelings : newEncounter.afterFeelings} 
                  onChange={val => editingEncounter ? setEditingEncounter({ ...editingEncounter, afterFeelings: val }) : setNewEncounter({ ...newEncounter, afterFeelings: val })}
                  className="h-32"
                />
              </div>
            </div>

            <button 
              onClick={handleSave}
              disabled={isSaving}
              className={`w-full py-4 bg-emerald-500 text-white rounded-2xl font-bold shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all mt-12 ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Save className="w-5 h-5 inline-block mr-2" />
              {isSaving ? 'Zapisywanie...' : (editingEncounter ? 'Zapisz zmiany' : 'Zapisz zbliżenie')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-4">
            {encounters.map(e => (
              <div key={e.id} className="bg-white p-6 rounded-3xl shadow-sm border border-stone-100 relative group">
                <div className="absolute top-6 right-6 flex gap-2 z-10">
                  <button 
                    onClick={() => setEditingEncounter(e)}
                    className="p-2 bg-stone-100 text-stone-600 rounded-lg hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setDeleteId(e.id)}
                    className="p-2 bg-stone-100 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold">{e.partnerName || 'Anonimowy partner'}</h3>
                  <span className="text-[10px] font-bold text-stone-400 uppercase">{format(parseISO(e.timestamp), 'dd.MM.yyyy')}</span>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {e.sexType?.map(type => (
                    <span key={type} className="px-2 py-1 bg-stone-100 rounded-md text-[10px] font-bold text-stone-600 uppercase">
                      {type === 'other' ? e.sexTypeOther : (type === 'vaginal' ? 'Waginalny' : type === 'anal' ? 'Analny' : 'Oralny')}
                    </span>
                  ))}
                  {e.protection?.map(prot => (
                    <span key={prot} className="px-2 py-1 bg-stone-100 rounded-md text-[10px] font-bold text-stone-600 uppercase">
                      {prot === 'other' ? e.protectionOther : (prot === 'condom' ? 'Prezerwatywa' : prot === 'prep' ? 'PrEP' : 'Bez zab.')}
                    </span>
                  ))}
                  {e.chemsex && <span className="px-2 py-1 bg-amber-100 rounded-md text-[10px] font-bold text-amber-600 uppercase">Chemsex</span>}
                  {e.hasConcerns && (
                    <div className="mt-2 p-3 bg-red-50 rounded-xl border border-red-100">
                      <p className="text-[10px] font-bold text-red-600 uppercase mb-1">
                        Zaniepokojenie ({e.concernLocation === 'me' ? 'U mnie' : e.concernLocation === 'partner' ? 'U partnera' : 'U obu'})
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {e.symptoms?.map(s => (
                          <span key={s} className="text-[10px] text-red-700 bg-red-100 px-2 py-0.5 rounded-full font-medium">
                            {s === 'Inne' ? e.symptomsOther : s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {e.afterFeelings && (
                  <div className="mt-4 p-4 bg-stone-50 rounded-2xl border border-stone-100">
                    <p className="text-[10px] font-bold text-stone-400 uppercase mb-2">Uczucia i emocje</p>
                    <div className="text-sm text-stone-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: e.afterFeelings }} />
                  </div>
                )}
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-stone-400 uppercase">Doznania:</span>
                    <span className="text-sm font-bold text-emerald-600">{e.moodScore}/10</span>
                  </div>
                  {e.wantToMeetAgain && (
                    <span className="text-[10px] font-bold text-emerald-500 uppercase">Chcę się spotkać ponownie</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {encounters.length > 0 && (
            <div className="bg-red-50 p-6 rounded-3xl border border-red-100 mt-8">
              <h3 className="font-bold text-red-600 mb-2 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5" /> Powiadom partnerów
              </h3>
              <p className="text-xs text-red-500 mb-4">Jeśli wykryłeś u siebie infekcję, możesz anonimowo powiadomić osoby, z którymi miałeś kontakt.</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center bg-white border border-red-200 rounded-xl px-3 py-2">
                  <input 
                    type="number" 
                    value={customDays} 
                    onChange={e => setCustomDays(parseInt(e.target.value) || 0)}
                    className="w-full outline-none text-sm font-bold text-red-600"
                    min="1"
                  />
                  <span className="text-[10px] font-bold text-red-300 uppercase ml-2">dni</span>
                </div>
                <button 
                  onClick={() => notifyPartners(customDays)} 
                  className="px-6 py-2 bg-red-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-red-500/20"
                >
                  Powiadom
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};

// --- Admin Tab ---

const ReminderItem: React.FC<{ 
  label: string, 
  lastTest?: string, 
  interval?: number, 
  nextTest?: string,
  onUpdate: (date: string, interval: number) => void 
}> = ({ label, lastTest, interval = 3, nextTest, onUpdate }) => {
  const [date, setDate] = useState(lastTest || '');
  const [months, setMonths] = useState(interval);

  return (
    <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
      <h3 className="font-bold text-stone-900 mb-4">{label}</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Ostatnie badanie</label>
          <input 
            type="date" 
            value={date}
            onChange={e => {
              setDate(e.target.value);
              onUpdate(e.target.value, months);
            }}
            className="w-full p-2 bg-white border border-stone-200 rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Częstotliwość (miesiące)</label>
          <select 
            value={months}
            onChange={e => {
              const val = parseInt(e.target.value);
              setMonths(val);
              onUpdate(date, val);
            }}
            className="w-full p-2 bg-white border border-stone-200 rounded-lg text-sm"
          >
            <option value={1}>Co miesiąc</option>
            <option value={3}>Co 3 miesiące</option>
            <option value={6}>Co 6 miesięcy</option>
            <option value={12}>Raz w roku</option>
          </select>
        </div>
        {nextTest && (
          <div className="pt-2 flex items-center justify-between">
            <span className="text-xs text-stone-500">Następne badanie:</span>
            <span className={`text-xs font-bold ${isBefore(parseISO(nextTest), new Date()) ? 'text-red-500' : 'text-emerald-600'}`}>
              {format(parseISO(nextTest), 'dd.MM.yyyy')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

const AdminTab: React.FC<{ profile: UserProfile | null }> = ({ profile }) => {
  const [pages, setPages] = useState<AdminContent[]>([]);
  const [editingPage, setEditingPage] = useState<Partial<AdminContent> | null>(null);
  const [activeSection, setActiveSection] = useState<'content' | 'settings'>('content');

  useEffect(() => {
    const q = query(collection(db, 'admin_content'), orderBy('lastUpdated', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setPages(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AdminContent)));
    });
  }, []);

  const handleSave = async () => {
    if (!editingPage?.slug || !editingPage?.title || !editingPage?.body) return;
    const data = {
      ...editingPage,
      lastUpdated: new Date().toISOString()
    };
    if (editingPage.id) {
      await updateDoc(doc(db, 'admin_content', editingPage.id), data);
    } else {
      await addDoc(collection(db, 'admin_content'), data);
    }
    setEditingPage(null);
  };

  const updateProfile = async (data: Partial<UserProfile>) => {
    if (!profile?.id) return;
    await updateDoc(doc(db, 'users', profile.id), data);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Panel Admina</h1>
        {activeSection === 'content' && !editingPage && (
          <button 
            onClick={() => setEditingPage({ slug: '', title: '', body: '' })}
            className="p-3 bg-stone-900 text-white rounded-2xl shadow-lg"
          >
            <Plus className="w-6 h-6" />
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-8 p-1 bg-stone-100 rounded-2xl">
        <button 
          onClick={() => setActiveSection('content')}
          className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${activeSection === 'content' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400'}`}
        >
          Treści
        </button>
        <button 
          onClick={() => setActiveSection('settings')}
          className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${activeSection === 'settings' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400'}`}
        >
          Ustawienia
        </button>
      </div>

      {activeSection === 'content' ? (
        editingPage ? (
          <div className="bg-white p-6 rounded-3xl shadow-xl border border-stone-100">
            <div className="space-y-4">
              <input 
                type="text" placeholder="Slug (np. landing)"
                value={editingPage.slug}
                onChange={e => setEditingPage({ ...editingPage, slug: e.target.value })}
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none"
              />
              <input 
                type="text" placeholder="Tytuł"
                value={editingPage.title}
                onChange={e => setEditingPage({ ...editingPage, title: e.target.value })}
                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none"
              />
              <div className="bg-stone-50 rounded-xl overflow-hidden border border-stone-200">
                <ReactQuill 
                  theme="snow" 
                  value={editingPage.body} 
                  onChange={val => setEditingPage({ ...editingPage, body: val })}
                  className="h-96"
                />
              </div>
              <div className="flex gap-4 pt-12">
                <button onClick={() => setEditingPage(null)} className="flex-1 py-4 bg-stone-100 rounded-2xl font-bold">Anuluj</button>
                <button onClick={handleSave} className="flex-1 py-4 bg-stone-900 text-white rounded-2xl font-bold">Zapisz</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {pages.map(page => (
              <div key={page.id} className="bg-white p-6 rounded-3xl shadow-sm border border-stone-100 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg">{page.title}</h3>
                  <p className="text-xs text-stone-400">/{page.slug}</p>
                </div>
                <button onClick={() => setEditingPage(page)} className="p-2 text-stone-400 hover:text-stone-900">
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-stone-100">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Bell className="w-6 h-6 text-emerald-500" /> Przypomnienia o badaniach
            </h2>
            <div className="space-y-6">
              <ReminderItem 
                label="Badanie HIV" 
                lastTest={profile?.nextHivTestDate} 
                interval={profile?.hivTestIntervalMonths}
                onUpdate={(date, interval) => updateProfile({ nextHivTestDate: date, hivTestIntervalMonths: interval })}
              />
              <ReminderItem 
                label="Badanie Kiły" 
                lastTest={profile?.nextSyphilisTestDate} 
                interval={profile?.syphilisTestIntervalMonths}
                onUpdate={(date, interval) => updateProfile({ nextSyphilisTestDate: date, syphilisTestIntervalMonths: interval })}
              />
            </div>
          </div>
          
          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-stone-100">
            <h2 className="text-xl font-bold mb-4">Profil</h2>
            <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
              <p className="text-sm text-stone-600">Zalogowany jako: <span className="font-bold text-stone-900">{profile?.name}</span></p>
              <p className="text-xs text-stone-400 mt-1">Rola: {profile?.role}</p>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

const NotificationOverlay: React.FC<{ notifications: InfectionNotification[], setNotifications: any }> = ({ notifications, setNotifications }) => {
  if (notifications.length === 0) return null;

  const markAsRead = async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-red-500/20 backdrop-blur-md">
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="bg-white p-8 rounded-[2rem] max-w-md w-full shadow-2xl border-4 border-red-500">
        <div className="flex justify-center mb-6">
          <div className="p-4 bg-red-100 rounded-full">
            <AlertCircle className="w-12 h-12 text-red-500" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center mb-4">Ważne powiadomienie</h2>
        <div className="space-y-4 mb-8">
          {notifications.map(n => (
            <div key={n.id} className="bg-red-50 p-4 rounded-2xl border border-red-100">
              <p className="text-sm text-red-700 leading-relaxed">
                Jeden z Twoich partnerów, z którym miałeś kontakt około <strong>{n.encounterDate}</strong>, zgłosił infekcję.
              </p>
              <p className="text-xs text-red-600 mt-2 font-bold">Zbadaj się pilnie, zrób testy i skontaktuj się z lekarzem.</p>
              <button onClick={() => markAsRead(n.id!)} className="mt-3 text-[10px] font-bold uppercase tracking-widest text-red-400 hover:text-red-700">Oznacz jako przeczytane</button>
            </div>
          ))}
        </div>
        <button onClick={() => setNotifications([])} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold">Rozumiem</button>
      </motion.div>
    </div>
  );
};

export default App;
