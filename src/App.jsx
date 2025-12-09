import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  doc, 
  onSnapshot, 
  query, 
  serverTimestamp, 
  writeBatch,
  increment,
  getDoc
} from 'firebase/firestore';
import { 
  LayoutDashboard, 
  PlusCircle, 
  Calendar, 
  ClipboardList, 
  Calculator, 
  Users, 
  Settings, 
  CheckCircle2, 
  Menu, 
  X, 
  Trash2,
  Activity,
  Package,
  Layers
} from 'lucide-react';

// --- PRODUCTION FIREBASE CONFIGURATION ---
// Hardcoded keys to prevent White Screen issues and ensure immediate connection
const firebaseConfig = {
  apiKey: "AIzaSyDdQaeU2kbxP5aayG22AnytNVIUM6taoqU",
  authDomain: "productschedule-f0b2b.firebaseapp.com",
  projectId: "productschedule-f0b2b",
  storageBucket: "productschedule-f0b2b.firebasestorage.app",
  messagingSenderId: "539789217888",
  appId: "1:539789217888:web:e77fc013d94c13f812f305",
  measurementId: "G-Y7YW14ECN4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Use a single, clean root collection for all data
const DB_PREFIX = 'aqua_production';

// --- Types & Default Data ---

const ALL_STEPS_DEFINITIONS = [
  // Printing Options (Order 1)
  { 
    id: 'printing_screen', 
    name: 'Printing - Screen', 
    order: 1, 
    minWorkers: 1,
    maxWorkers: 2,
    setupTime: 20,
    defaultCapacityMap: JSON.stringify({ "1": 2400, "2": 3000 }) 
  },
  { 
    id: 'printing_uv', 
    name: 'Printing - UV', 
    order: 1, 
    minWorkers: 1,
    maxWorkers: 1,
    setupTime: 10,
    defaultCapacityMap: JSON.stringify({ "1": 768 }) 
  },

  // Cutting (Order 2)
  { 
    id: 'cutting', 
    name: 'Cutting', 
    order: 2, 
    minWorkers: 1,
    maxWorkers: 2,
    setupTime: 20,
    defaultCapacityMap: JSON.stringify({ "1": 400, "2": 750 }) 
  },

  // Stringing Options (Order 3)
  { 
    id: 'string_machine', 
    name: 'String Machine', 
    order: 3, 
    minWorkers: 1,
    maxWorkers: 1,
    setupTime: 10,
    defaultCapacityMap: JSON.stringify({ "1": 40 }) 
  },
  { 
    id: 'hanger_manual', 
    name: 'Hanger (Manual)', 
    order: 3, 
    minWorkers: 1,
    maxWorkers: 5,
    setupTime: 0,
    defaultCapacityMap: JSON.stringify({ "1": 900, "2": 1800, "3": 2700, "4": 3600, "5": 4500 }) 
  },

  // Finishing Steps (Order 4-6)
  { 
    id: 'flowpack', 
    name: 'Flowpack', 
    order: 4, 
    minWorkers: 2,
    maxWorkers: 4,
    setupTime: 45,
    defaultCapacityMap: JSON.stringify({ "2": 800, "3": 1200, "4": 1500 }) 
  },
  { 
    id: 'syraptiko', 
    name: 'Syraptiko', 
    order: 5, 
    minWorkers: 1,
    maxWorkers: 3,
    setupTime: 10,
    defaultCapacityMap: JSON.stringify({ "1": 350, "2": 680, "3": 1000 }) 
  },
  { 
    id: 'final_packing', 
    name: 'Final Packing', 
    order: 6, 
    minWorkers: 1,
    maxWorkers: 4,
    setupTime: 10,
    defaultCapacityMap: JSON.stringify({ "1": 600, "2": 1150, "3": 1700, "4": 2200 }) 
  },
];

const PRODUCT_TYPES = ['Paper Air Freshener', 'Air Wood', 'Diffuser', 'Aerosol', 'Other'];
const PRINTING_METHODS = ['Screen', 'UV', 'Pre-printed'];
const HANGING_METHODS = ['String', 'Hanger'];

// --- Helper Functions ---

const getProjectSteps = (printingMethod, hangingMethod) => {
  let steps = ALL_STEPS_DEFINITIONS.filter(s => 
    !['printing_screen', 'printing_uv', 'string_machine', 'hanger_manual'].includes(s.id)
  );

  if (printingMethod === 'Screen') steps.push(ALL_STEPS_DEFINITIONS.find(s => s.id === 'printing_screen'));
  else if (printingMethod === 'UV') steps.push(ALL_STEPS_DEFINITIONS.find(s => s.id === 'printing_uv'));

  if (hangingMethod === 'String') steps.push(ALL_STEPS_DEFINITIONS.find(s => s.id === 'string_machine'));
  else if (hangingMethod === 'Hanger') steps.push(ALL_STEPS_DEFINITIONS.find(s => s.id === 'hanger_manual'));

  return steps.sort((a, b) => a.order - b.order);
};

const getCapacityForWorkers = (stepDef, workerCount, parameters = []) => {
  const customParam = parameters.find(p => p.stepId === stepDef.id);
  let map = {};
  try {
    const jsonStr = customParam?.capacityMapJSON || stepDef.defaultCapacityMap;
    map = JSON.parse(jsonStr);
  } catch (e) {
    return 0;
  }
  if (map[workerCount]) return Number(map[workerCount]);
  const counts = Object.keys(map).map(Number).sort((a,b) => a-b);
  if (workerCount >= counts[counts.length - 1]) return Number(map[counts[counts.length - 1]]); 
  return 0; 
};

const getParamValue = (stepId, field, parameters, defaultVal) => {
  const param = parameters.find(p => p.stepId === stepId);
  return param && param[field] ? param[field] : defaultVal;
};

const getStockId = (productType, stepId) => `${productType.replace(/\s+/g, '')}_${stepId}`;

// --- Components ---

const App = () => {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth Error:", err);
        setError(err.message);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        if (currentUser) setUser(currentUser);
    }, (err) => setError(err.message));
    return () => unsubscribe();
  }, []);

  if (error) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-red-50 text-red-800 p-8 text-center">
      <h2 className="text-2xl font-bold mb-4">Connection Error</h2>
      <p className="mb-4">{error}</p>
      <p className="text-sm text-slate-600">Check your Auth Settings in Firebase Console.</p>
    </div>
  );

  if (!user) return <div className="min-h-screen flex items-center justify-center bg-cyan-50 text-cyan-800">Loading AQUA Scheduler 2.4...</div>;

  const NavItem = ({ target, icon: Icon, label }) => (
    <button
      onClick={() => { setView(target); setMobileMenuOpen(false); }}
      className={`flex items-center space-x-3 w-full px-4 py-3 rounded-lg transition-colors ${
        view === target ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-600 hover:bg-cyan-100'
      }`}
    >
      <Icon size={20} />
      <span className="font-medium">{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden bg-white p-4 shadow-sm flex justify-between items-center z-20 relative">
        <h1 className="text-xl font-bold text-cyan-700">AQUA Scheduler</h1>
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 transform ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0 transition duration-200 ease-in-out
        w-64 bg-white border-r border-slate-200 flex flex-col z-10 shadow-xl md:shadow-none
      `}>
        <div className="p-6 border-b border-slate-100 hidden md:block">
          <h1 className="text-2xl font-extrabold text-cyan-600 tracking-tight">AQUA<span className="text-slate-400 text-sm block font-normal">Production v2.4</span></h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <NavItem target="dashboard" icon={LayoutDashboard} label="Dashboard" />
          <NavItem target="new_project" icon={PlusCircle} label="Start Project" />
          <NavItem target="log_output" icon={ClipboardList} label="Record Output" />
          <NavItem target="planning" icon={Calendar} label="Daily Planning" />
          <NavItem target="worker_activity" icon={Activity} label="Worker Activity" />
          <NavItem target="calculator" icon={Calculator} label="Ref. Calculator" />
          <div className="pt-4 mt-4 border-t border-slate-100">
            <NavItem target="workers" icon={Users} label="Workers" />
            <NavItem target="settings" icon={Settings} label="Settings" />
          </div>
        </nav>

        <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-400">
          User: {user.uid.slice(0, 6)}...
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-screen bg-slate-50">
        <div className="max-w-6xl mx-auto">
          {view === 'dashboard' && <Dashboard user={user} setView={setView} />}
          {view === 'new_project' && <NewProject user={user} setView={setView} />}
          {view === 'log_output' && <RecordOutput user={user} setView={setView} />}
          {view === 'planning' && <DailyPlanning user={user} setView={setView} />}
          {view === 'worker_activity' && <WorkerActivityScreen user={user} />}
          {view === 'calculator' && <ReferenceCalculator user={user} />}
          {view === 'workers' && <WorkerManager user={user} />}
          {view === 'settings' && <SettingsScreen user={user} />}
        </div>
      </main>
    </div>
  );
};

// --- DATA HOOKS ---

const useCollection = (collectionName, user) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    // UPDATED: Using simple root collection path DB_PREFIX
    const q = collection(db, DB_PREFIX, collectionName); 
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setData(items);
      setLoading(false);
    }, (err) => console.error(err));
    return () => unsubscribe();
  }, [user, collectionName]);

  return { data, loading };
};

// --- VIEWS ---

const Dashboard = ({ user, setView }) => {
  const { data: projects } = useCollection('projects', user);
  const { data: stocks } = useCollection('step_stocks', user);
  
  const activeProjects = projects.filter(p => p.status !== 'Completed' && p.status !== 'Cancelled');

  const handleDelete = async (projectId) => {
    if (confirm('Are you sure you want to delete this project? This cannot be undone.')) {
      await deleteDoc(doc(db, DB_PREFIX, 'projects', projectId));
    }
  };

  const getProjectedCompletion = (project) => {
    const remainingUnits = project.targetQuantity - (project.progress?.final_packing?.completed || 0);
    const daysLeft = Math.ceil(remainingUnits / 1500); 
    if (remainingUnits <= 0) return 'Ready';
    return `${daysLeft} days`;
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-800">Production Dashboard</h2>
          <p className="text-slate-500">Real-time shop floor status & stock.</p>
        </div>
        <div className="flex gap-2">
           <button onClick={() => setView('worker_activity')} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg shadow-sm flex items-center gap-2">
            <Activity size={18} /> Staff Activity
          </button>
          <button onClick={() => setView('new_project')} className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg shadow flex items-center gap-2">
            <PlusCircle size={18} /> New Project
          </button>
        </div>
      </header>

      {/* Stock Ticker */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
          <Layers size={14} /> Global Semi-Finished Stock (History)
        </h3>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {stocks.length === 0 && <span className="text-sm text-slate-400">No stock recorded yet.</span>}
          {stocks.filter(s => s.quantity > 0).map(s => (
            <div key={s.id} className="min-w-[140px] bg-slate-50 p-3 rounded-lg border border-slate-100">
               <div className="text-[10px] text-slate-500 truncate" title={s.productType}>{s.productType}</div>
               <div className="font-bold text-slate-700 text-sm truncate">{ALL_STEPS_DEFINITIONS.find(def => def.id === s.stepId)?.name || s.stepId}</div>
               <div className="text-cyan-600 font-mono font-bold">{s.quantity.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Project Cards */}
      <div className="grid grid-cols-1 gap-6">
        {activeProjects.map(project => {
          const relevantSteps = getProjectSteps(project.printingMethod || 'Screen', project.hangingMethod || 'String');
          const finalPacked = project.progress?.final_packing?.completed || 0;
          const percent = Math.min(100, Math.round((finalPacked / project.targetQuantity) * 100));
          const projection = getProjectedCompletion(project);
          
          return (
            <div key={project.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-1 text-xs font-bold text-cyan-700 bg-cyan-100 rounded uppercase tracking-wide">{project.type}</span>
                        <span className="text-xs text-slate-500 border border-slate-200 px-2 py-1 rounded bg-slate-50">Print: {project.printingMethod}</span>
                        <span className="text-xs text-slate-500 border border-slate-200 px-2 py-1 rounded bg-slate-50">Hang: {project.hangingMethod}</span>
                    </div>
                    <h3 className="text-xl font-bold text-slate-800">{project.name}</h3>
                    <p className="text-slate-500 text-sm">Target: {project.targetQuantity.toLocaleString()} | Remaining: {(project.targetQuantity - finalPacked).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-slate-700">{percent}%</div>
                    <div className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded inline-block mt-1">
                      Est. Finish: {projection}
                    </div>
                  </div>
                </div>

                {/* Progress Grid */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
                  {relevantSteps.map(step => {
                     const completed = project.progress?.[step.id]?.completed || 0;
                     const stockUsed = project.progress?.[step.id]?.stockUsed || 0;
                     const stepPct = Math.min(100, Math.round((completed / project.targetQuantity) * 100));
                     
                     return (
                       <div key={step.id} className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                         <div className="text-xs font-semibold text-slate-600 truncate mb-1">{step.name}</div>
                         <div className="flex justify-between items-end">
                            <span className="text-sm font-bold text-slate-800">{stepPct}%</span>
                            {stockUsed > 0 && (
                              <span className="text-[10px] text-amber-600 bg-amber-50 px-1 rounded" title={`Stock used: ${stockUsed}`}>Init: {stockUsed}</span>
                            )}
                         </div>
                         <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2">
                           <div className={`h-1.5 rounded-full ${stepPct >= 100 ? 'bg-emerald-500' : 'bg-cyan-500'}`} style={{ width: `${stepPct}%` }}></div>
                         </div>
                       </div>
                     )
                  })}
                </div>

                <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                   <button onClick={() => handleDelete(project.id)} className="text-red-400 hover:text-red-600 text-sm flex items-center gap-1">
                     <Trash2 size={14} /> Delete
                   </button>
                   <div className="flex gap-3">
                      <button onClick={() => setView('planning')} className="text-sm font-medium text-slate-600 hover:text-cyan-700">Daily Planning &rarr;</button>
                      <button onClick={() => setView('log_output')} className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900">Record Output</button>
                   </div>
                </div>
              </div>
            </div>
          );
        })}

        {activeProjects.length === 0 && (
            <div className="text-center py-16 bg-white rounded-xl border-2 border-dashed border-slate-300">
                <LayoutDashboard className="mx-auto text-slate-300 mb-4" size={48} />
                <h3 className="text-lg font-medium text-slate-900">No active projects</h3>
                <p className="text-slate-500 mb-6">Get started by creating your first production run.</p>
                <button onClick={() => setView('new_project')} className="bg-cyan-600 text-white px-6 py-2 rounded-lg font-medium">Create Project</button>
            </div>
        )}
      </div>
    </div>
  );
};

const NewProject = ({ user, setView }) => {
  const { data: stocks } = useCollection('step_stocks', user);
  
  const [formData, setFormData] = useState({
    name: '',
    type: PRODUCT_TYPES[0],
    target: 1000,
    startDate: new Date().toISOString().split('T')[0],
    printingMethod: 'Screen',
    hangingMethod: 'String',
    notes: ''
  });
  
  // Track stock usage for the current setup
  const [stockAllocation, setStockAllocation] = useState({});

  const [loading, setLoading] = useState(false);

  const relevantSteps = useMemo(() => 
    getProjectSteps(formData.printingMethod, formData.hangingMethod),
  [formData.printingMethod, formData.hangingMethod]);

  const handleStockChange = (stepId, val) => {
    // Manual Stock Entry (No Database Check)
    const max = Number(formData.target);
    let safeVal = Math.min(Number(val), max);
    safeVal = Math.max(0, safeVal);
    setStockAllocation(prev => ({...prev, [stepId]: safeVal}));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    try {
      const batch = writeBatch(db);

      // 1. Prepare Initial Progress
      const initialProgress = {};
      ALL_STEPS_DEFINITIONS.forEach(step => {
        const used = stockAllocation[step.id] || 0;
        initialProgress[step.id] = { 
          completed: used, 
          stockUsed: used, 
          lastUpdate: serverTimestamp() 
        };
      });

      // Fixed: Using DB_PREFIX collection path
      const projectRef = doc(collection(db, DB_PREFIX, 'projects'));
      batch.set(projectRef, {
        ...formData,
        targetQuantity: Number(formData.target),
        status: 'Planned',
        createdDate: serverTimestamp(),
        progress: initialProgress
      });

      // Note: We deliberately DO NOT decrement step_stocks history here
      // per user request for manual entry independence.

      await batch.commit();
      setView('dashboard');
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-slate-200">
      <h2 className="text-2xl font-bold mb-6 text-slate-800">Start New Project</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Project Name</label>
          <input 
            required
            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500"
            value={formData.name}
            onChange={e => setFormData({...formData, name: e.target.value})}
            placeholder="e.g. Lavender Mist - Batch 55"
          />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Type</label>
            <select 
              className="w-full p-3 border border-slate-300 rounded-lg"
              value={formData.type}
              onChange={e => {
                setFormData({...formData, type: e.target.value});
                setStockAllocation({}); // Reset allocation on type change
              }}
            >
              {PRODUCT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Target Quantity</label>
            <input 
              required
              type="number"
              className="w-full p-3 border border-slate-300 rounded-lg"
              value={formData.target}
              onChange={e => setFormData({...formData, target: e.target.value})}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 bg-slate-50 p-4 rounded-lg border border-slate-100">
           <div>
             <label className="block text-sm font-bold text-slate-700 mb-2">Printing Method</label>
             <select 
               className="w-full p-3 border border-slate-300 rounded-lg"
               value={formData.printingMethod}
               onChange={e => setFormData({...formData, printingMethod: e.target.value})}
             >
               {PRINTING_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
             </select>
           </div>
           <div>
             <label className="block text-sm font-bold text-slate-700 mb-2">Hanging Method</label>
             <select 
               className="w-full p-3 border border-slate-300 rounded-lg"
               value={formData.hangingMethod}
               onChange={e => setFormData({...formData, hangingMethod: e.target.value})}
             >
               {HANGING_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
             </select>
           </div>
        </div>

        {/* Manual Stock Allocation Section */}
        <div className="bg-amber-50 p-4 rounded-lg border border-amber-100">
          <h3 className="text-sm font-bold text-amber-900 mb-3 flex items-center gap-2">
            <Package size={16} /> Enter Pre-Existing Stock (Manual Entry)
          </h3>
          <p className="text-xs text-amber-800 mb-3">
             If you already have finished pieces for any step, enter the amount below. This will not affect the history database.
          </p>
          <div className="space-y-3">
            {relevantSteps.map(step => {
               const allocated = stockAllocation[step.id] || '';
               
               return (
                 <div key={step.id} className="flex justify-between items-center text-sm">
                    <span className="text-amber-800 font-medium">{step.name}</span>
                    <input 
                      type="number"
                      min="0"
                      max={formData.target}
                      className="w-32 p-1 border border-amber-200 rounded text-right"
                      value={allocated}
                      onChange={e => handleStockChange(step.id, e.target.value)}
                      placeholder="0"
                    />
                 </div>
               )
            })}
          </div>
        </div>

        <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Start Date</label>
            <input 
              required
              type="date"
              className="w-full p-3 border border-slate-300 rounded-lg"
              value={formData.startDate}
              onChange={e => setFormData({...formData, startDate: e.target.value})}
            />
        </div>

        <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Notes</label>
            <textarea 
              className="w-full p-3 border border-slate-300 rounded-lg"
              rows={3}
              value={formData.notes}
              onChange={e => setFormData({...formData, notes: e.target.value})}
            />
        </div>

        <div className="flex gap-4 pt-4">
          <button type="button" onClick={() => setView('dashboard')} className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-lg">Cancel</button>
          <button type="submit" disabled={loading} className="flex-1 py-3 bg-cyan-600 text-white rounded-lg shadow font-medium">
            {loading ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  );
};

const DailyPlanning = ({ user, setView }) => {
  const { data: projects } = useCollection('projects', user);
  const { data: workers } = useCollection('workers', user);
  const { data: parameters } = useCollection('parameters', user);
  
  const [step, setStep] = useState(1);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [totalWorkers, setTotalWorkers] = useState(0);
  const [assignments, setAssignments] = useState({});
  const [assignmentNotes, setAssignmentNotes] = useState('');

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  
  const applicableSteps = useMemo(() => {
    if(!selectedProject) return [];
    const all = getProjectSteps(selectedProject.printingMethod, selectedProject.hangingMethod);
    // FILTER: Only show steps that still have remaining work > 0
    return all.filter(s => {
       const done = selectedProject.progress?.[s.id]?.completed || 0;
       return (selectedProject.targetQuantity - done) > 0;
    });
  }, [selectedProject]);

  useEffect(() => {
    if (selectedProjectId) {
      const init = {};
      applicableSteps.forEach(s => init[s.id] = 0);
      setAssignments(init);
    }
  }, [selectedProjectId, applicableSteps]);

  const handleAssign = (stepId, delta) => {
    const current = assignments[stepId] || 0;
    const newVal = Math.max(0, current + delta);
    const currentTotal = Object.values(assignments).reduce((a, b) => a + b, 0);
    if (delta > 0 && currentTotal >= totalWorkers) {
      alert("No more available workers!");
      return;
    }
    const stepDef = ALL_STEPS_DEFINITIONS.find(s => s.id === stepId);
    const max = getParamValue(stepId, 'maxWorkers', parameters, stepDef.maxWorkers);
    if (newVal > max) {
      alert(`Max workers for ${stepDef.name} is ${max}`);
      return;
    }
    setAssignments(prev => ({ ...prev, [stepId]: newVal }));
  };

  const calculateEstimates = () => {
    return applicableSteps.map(s => {
      const assigned = assignments[s.id] || 0;
      const capacity = getCapacityForWorkers(s, assigned, parameters);
      const remaining = selectedProject ? selectedProject.targetQuantity - (selectedProject.progress?.[s.id]?.completed || 0) : 0;
      const hoursNeeded = capacity > 0 ? (remaining / capacity).toFixed(1) : (remaining > 0 ? '∞' : 0);
      
      const start = new Date();
      start.setHours(8, 0, 0, 0);
      const end = new Date(start.getTime() + (capacity > 0 ? (remaining/capacity)*3600000 : 0));

      return {
        ...s,
        assigned,
        capacity,
        remaining,
        hoursNeeded,
        endTime: end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
    });
  };

  const savePlan = async () => {
    if (!selectedProject) return;
    try {
      const batchDate = new Date().toISOString().split('T')[0];
      await addDoc(collection(db, DB_PREFIX, 'daily_plans'), {
        projectId: selectedProjectId,
        date: batchDate,
        assignments: assignments,
        notes: assignmentNotes,
        createdAt: serverTimestamp()
      });
      alert('Daily Plan Saved!');
      setView('dashboard');
    } catch (e) {
      console.error(e);
      alert('Error saving plan');
    }
  };

  const estimates = calculateEstimates();

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">Daily Planning Wizard</h2>
        <div className="text-sm text-slate-500">Step {step} of 3</div>
      </div>

      {step === 1 && (
        <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 space-y-6">
          <h3 className="text-lg font-semibold">1. Setup Day</h3>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Select Project</label>
            <select 
              className="w-full p-3 border border-slate-300 rounded-lg"
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
            >
              <option value="">-- Choose Active Project --</option>
              {projects.filter(p => p.status !== 'Completed').map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Total Workers Available Today</label>
            <input 
              type="number" 
              className="w-full p-3 border border-slate-300 rounded-lg"
              value={totalWorkers}
              onChange={e => setTotalWorkers(Number(e.target.value))}
            />
          </div>
          <button 
            disabled={!selectedProjectId || totalWorkers < 1}
            onClick={() => setStep(2)}
            className="w-full py-3 bg-cyan-600 text-white rounded-lg font-medium disabled:opacity-50"
          >
            Next: Assign Workers
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
           {applicableSteps.length === 0 ? (
             <div className="bg-emerald-50 p-6 rounded-lg text-emerald-800 text-center">
               <CheckCircle2 className="mx-auto mb-2" />
               <p className="font-bold">No steps require work!</p>
               <p className="text-sm">Stock or previous work has completed all steps for this project.</p>
               <button onClick={() => setView('dashboard')} className="mt-4 text-emerald-700 underline">Return to Dashboard</button>
             </div>
           ) : (
             <>
             <div className="bg-cyan-50 border border-cyan-100 p-4 rounded-lg flex justify-between items-center">
               <span className="font-semibold text-cyan-900">Available Workers: {totalWorkers - Object.values(assignments).reduce((a,b)=>a+b,0)} remaining</span>
               <button onClick={() => setStep(1)} className="text-sm text-cyan-700 underline">Change Total</button>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {applicableSteps.map(s => {
                 const assigned = assignments[s.id] || 0;
                 const min = getParamValue(s.id, 'minWorkers', parameters, s.minWorkers);
                 const max = getParamValue(s.id, 'maxWorkers', parameters, s.maxWorkers);
                 const capacity = getCapacityForWorkers(s, assigned, parameters);
                 const remaining = selectedProject ? selectedProject.targetQuantity - (selectedProject.progress?.[s.id]?.completed || 0) : 0;

                 return (
                   <div key={s.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                     <div className="flex justify-between items-start mb-4">
                       <div>
                         <h4 className="font-bold text-slate-800">{s.name}</h4>
                         <p className="text-xs text-slate-500 mb-1">Remaining: {remaining.toLocaleString()}</p>
                         <p className="text-xs text-slate-400">Min: {min} | Max: {max}</p>
                       </div>
                       <div className="text-right">
                         <div className="text-sm font-mono text-cyan-600 font-bold">{capacity} units/hr</div>
                       </div>
                     </div>
                     
                     <div className="flex items-center gap-4">
                       <button onClick={() => handleAssign(s.id, -1)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200">-</button>
                       <span className="text-xl font-bold w-8 text-center">{assigned}</span>
                       <button onClick={() => handleAssign(s.id, 1)} className="w-8 h-8 rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center hover:bg-cyan-200">+</button>
                     </div>
                   </div>
                 );
               })}
             </div>
             
             <div className="flex gap-4">
               <button onClick={() => setStep(1)} className="px-6 py-3 bg-white border border-slate-300 rounded-lg">Back</button>
               <button onClick={() => setStep(3)} className="flex-1 py-3 bg-cyan-600 text-white rounded-lg font-medium">Next: Review Plan</button>
             </div>
             </>
           )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b">
                <tr>
                  <th className="p-4">Step</th>
                  <th className="p-4">Workers</th>
                  <th className="p-4">Capacity/Hr</th>
                  <th className="p-4">Rem. Qty</th>
                  <th className="p-4">Est. Hours</th>
                  <th className="p-4">Est. Finish</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {estimates.map(row => (
                  <tr key={row.id} className={row.remaining > 0 && Number(row.hoursNeeded) > 8 ? "bg-red-50" : ""}>
                    <td className="p-4 font-medium">{row.name}</td>
                    <td className="p-4 font-bold">{row.assigned}</td>
                    <td className="p-4 text-slate-500">{row.capacity}</td>
                    <td className="p-4">{row.remaining}</td>
                    <td className="p-4 font-mono">{row.hoursNeeded}</td>
                    <td className="p-4">{row.endTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-amber-50 p-4 rounded-lg border border-amber-100 text-amber-800 text-sm">
             <strong>Bottleneck Analysis:</strong>
             <ul className="list-disc ml-5 mt-2 space-y-1">
               {estimates.some(e => Number(e.hoursNeeded) > 8) && <li>Some steps will take longer than 8 hours. Consider adding overtime or shifting workers.</li>}
             </ul>
          </div>

          <div>
             <label className="block text-sm font-medium text-slate-700 mb-2">Planning Notes</label>
             <textarea 
               className="w-full p-3 border border-slate-300 rounded-lg"
               placeholder="e.g., John leaving early, prioritize Flowpack..."
               value={assignmentNotes}
               onChange={e => setAssignmentNotes(e.target.value)}
             />
          </div>

          <div className="flex gap-4">
             <button onClick={() => setStep(2)} className="px-6 py-3 bg-white border border-slate-300 rounded-lg">Adjust Assignments</button>
             <button onClick={savePlan} className="flex-1 py-3 bg-emerald-600 text-white rounded-lg font-medium shadow hover:bg-emerald-700">Confirm & Save Plan</button>
          </div>
        </div>
      )}
    </div>
  );
};

const RecordOutput = ({ user, setView }) => {
  const { data: projects } = useCollection('projects', user);
  const { data: workers } = useCollection('workers', user);
  const activeProjects = projects.filter(p => p.status !== 'Completed');

  const [form, setForm] = useState({
    projectId: '',
    stepId: '',
    quantity: '',
    startTime: '',
    endTime: '',
    workersUsed: [],
    notes: ''
  });

  const selectedProject = projects.find(p => p.id === form.projectId);
  // Dynamically load steps based on the project selected in the form
  const availableSteps = selectedProject 
    ? getProjectSteps(selectedProject.printingMethod, selectedProject.hangingMethod) 
    : [];

  useEffect(() => {
    // Reset step ID when project changes to prevent mismatch
    if (availableSteps.length > 0) {
      setForm(prev => ({ ...prev, stepId: availableSteps[0].id }));
    }
  }, [selectedProject]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.projectId || !form.quantity) return;

    const project = projects.find(p => p.id === form.projectId);
    const currentCompleted = project.progress?.[form.stepId]?.completed || 0;
    const newCompleted = currentCompleted + Number(form.quantity);
    
    // Calculate Duration
    let duration = 0;
    if (form.startTime && form.endTime) {
      const start = new Date(`1970-01-01T${form.startTime}`);
      const end = new Date(`1970-01-01T${form.endTime}`);
      duration = (end - start) / 3600000; // hours
    }

    try {
      const batch = writeBatch(db);

      // 1. Update Project Progress (FIXED: Using DB_PREFIX)
      const projectRef = doc(db, DB_PREFIX, 'projects', form.projectId);
      batch.update(projectRef, {
        [`progress.${form.stepId}.completed`]: newCompleted,
        [`progress.${form.stepId}.lastUpdate`]: serverTimestamp()
      });

      // 2. Increment Stock for future use (FIXED: Using DB_PREFIX)
      const stockKey = getStockId(project.type, form.stepId);
      const stockRef = doc(db, DB_PREFIX, 'step_stocks', stockKey);
      // We use set with merge true to handle case where stock doc doesn't exist yet
      batch.set(stockRef, { 
        productType: project.type,
        stepId: form.stepId,
        quantity: increment(Number(form.quantity)), 
        lastUpdate: serverTimestamp() 
      }, { merge: true });

      // 3. Add Production Log (FIXED: Using DB_PREFIX)
      const logRef = doc(collection(db, DB_PREFIX, 'daily_logs'));
      batch.set(logRef, {
        ...form,
        projectName: project.name,
        durationHours: duration.toFixed(2),
        date: new Date().toISOString().split('T')[0],
        timestamp: serverTimestamp()
      });

      // 4. Update Worker Activity (FIXED: Using DB_PREFIX)
      const batchDate = new Date().toISOString().split('T')[0];
      const stepName = availableSteps.find(s => s.id === form.stepId)?.name || form.stepId;
      
      form.workersUsed.forEach(workerId => {
        const actRef = doc(collection(db, DB_PREFIX, 'worker_activities'));
        batch.set(actRef, {
          workerId,
          projectId: form.projectId,
          projectName: project.name,
          stepId: form.stepId,
          stepName,
          date: batchDate,
          startTime: form.startTime,
          endTime: form.endTime,
          hoursWorked: duration.toFixed(2),
          quantityProduced: Number(form.quantity) / form.workersUsed.length,
          enteredByWorker: true,
          timestamp: serverTimestamp()
        });
      });

      await batch.commit();

      alert('Output Recorded & Stock Updated!');
      setView('dashboard');
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const toggleWorker = (id) => {
    if (form.workersUsed.includes(id)) {
      setForm({...form, workersUsed: form.workersUsed.filter(w => w !== id)});
    } else {
      setForm({...form, workersUsed: [...form.workersUsed, id]});
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-slate-200">
      <h2 className="text-2xl font-bold mb-6 text-slate-800">Record Daily Output</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Project</label>
          <select 
            required
            className="w-full p-3 border border-slate-300 rounded-lg"
            value={form.projectId}
            onChange={e => setForm({...form, projectId: e.target.value})}
          >
            <option value="">-- Select Project --</option>
            {activeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-6">
           <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Step</label>
            <select 
              className="w-full p-3 border border-slate-300 rounded-lg"
              value={form.stepId}
              onChange={e => setForm({...form, stepId: e.target.value})}
              disabled={!form.projectId}
            >
              {availableSteps.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              {availableSteps.length === 0 && <option>Select Project First</option>}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Quantity Produced</label>
            <input 
              required
              type="number"
              className="w-full p-3 border border-slate-300 rounded-lg"
              value={form.quantity}
              onChange={e => setForm({...form, quantity: e.target.value})}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
           <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Start Time</label>
            <input 
              type="time"
              className="w-full p-3 border border-slate-300 rounded-lg"
              value={form.startTime}
              onChange={e => setForm({...form, startTime: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">End Time</label>
            <input 
              type="time"
              className="w-full p-3 border border-slate-300 rounded-lg"
              value={form.endTime}
              onChange={e => setForm({...form, endTime: e.target.value})}
            />
          </div>
        </div>

        <div>
           <label className="block text-sm font-medium text-slate-700 mb-2">Workers Involved</label>
           <div className="flex flex-wrap gap-2 border p-3 rounded-lg border-slate-300 bg-slate-50 max-h-40 overflow-y-auto">
             {workers.map(w => (
               <button
                 type="button"
                 key={w.id}
                 onClick={() => toggleWorker(w.id)}
                 className={`px-3 py-1 rounded-full text-xs font-medium border ${
                   form.workersUsed.includes(w.id) 
                     ? 'bg-cyan-600 text-white border-cyan-600' 
                     : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                 }`}
               >
                 {w.name}
               </button>
             ))}
           </div>
        </div>

        <button type="submit" className="w-full py-3 bg-cyan-600 text-white rounded-lg font-bold hover:bg-cyan-700 shadow">Save Production Log</button>
      </form>
    </div>
  );
};

const WorkerActivityScreen = ({ user }) => {
  const { data: activities } = useCollection('worker_activities', user);
  const { data: workers } = useCollection('workers', user);
  const [selectedWorker, setSelectedWorker] = useState('');

  const filtered = selectedWorker ? activities.filter(a => a.workerId === selectedWorker) : activities;

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center">
         <h2 className="text-2xl font-bold text-slate-800">Worker Activity History</h2>
         <select 
           className="p-2 border border-slate-300 rounded-lg"
           value={selectedWorker}
           onChange={e => setSelectedWorker(e.target.value)}
         >
           <option value="">All Workers</option>
           {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
         </select>
       </div>

       <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
         <table className="w-full text-sm text-left">
           <thead className="bg-slate-50 text-slate-600">
             <tr>
               <th className="p-4">Date</th>
               <th className="p-4">Worker</th>
               <th className="p-4">Task</th>
               <th className="p-4">Hours</th>
               <th className="p-4">Est. Qty</th>
               <th className="p-4">Project</th>
             </tr>
           </thead>
           <tbody className="divide-y divide-slate-100">
             {filtered.sort((a,b) => b.timestamp?.seconds - a.timestamp?.seconds).map(act => {
                const workerName = workers.find(w => w.id === act.workerId)?.name || 'Unknown';
                return (
                  <tr key={act.id} className="hover:bg-slate-50">
                    <td className="p-4">{act.date}</td>
                    <td className="p-4 font-medium">{workerName}</td>
                    <td className="p-4">{act.stepName}</td>
                    <td className="p-4 text-slate-500">{act.hoursWorked || '-'}</td>
                    <td className="p-4">{Math.round(act.quantityProduced)}</td>
                    <td className="p-4 text-xs text-slate-400">{act.projectName}</td>
                  </tr>
                )
             })}
             {filtered.length === 0 && (
               <tr><td colSpan="6" className="p-8 text-center text-slate-400">No activity recorded yet.</td></tr>
             )}
           </tbody>
         </table>
       </div>
    </div>
  );
};

const SettingsScreen = ({ user }) => {
  const { data: parameters } = useCollection('parameters', user);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const startEdit = (stepId, existingParam, stepDef) => {
    setEditingId(stepId);
    setEditForm({
      stepId,
      minWorkers: existingParam?.minWorkers || stepDef.minWorkers,
      maxWorkers: existingParam?.maxWorkers || stepDef.maxWorkers,
      setupTime: existingParam?.setupTime || stepDef.setupTime,
      capacityMapJSON: existingParam?.capacityMapJSON || stepDef.defaultCapacityMap,
    });
  };

  const saveEdit = async () => {
    try {
      JSON.parse(editForm.capacityMapJSON);
    } catch (e) {
      alert("Invalid JSON format for Capacity Map");
      return;
    }

    const existingId = parameters.find(p => p.stepId === editingId)?.id;
    
    try {
      if (existingId) {
        await updateDoc(doc(db, DB_PREFIX, 'parameters', existingId), editForm);
      } else {
        await addDoc(collection(db, DB_PREFIX, 'parameters'), editForm);
      }
      setEditingId(null);
    } catch(e) {
      alert("Error saving: " + e.message);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-800">System Settings</h2>
      
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 bg-slate-50 border-b border-slate-100">
           <h3 className="font-bold text-slate-700">Machine Parameters</h3>
           <p className="text-sm text-slate-500">Configure worker constraints and production speeds.</p>
        </div>
        
        <div className="divide-y divide-slate-100">
          {ALL_STEPS_DEFINITIONS.map(step => {
            const param = parameters.find(p => p.stepId === step.id);
            const isEditing = editingId === step.id;

            return (
              <div key={step.id} className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="font-bold text-lg text-slate-800">{step.name}</h4>
                    {!isEditing && <p className="text-sm text-slate-500">Min: {param?.minWorkers || step.minWorkers} | Max: {param?.maxWorkers || step.maxWorkers}</p>}
                  </div>
                  {!isEditing ? (
                    <button onClick={() => startEdit(step.id, param, step)} className="text-cyan-600 font-medium text-sm hover:underline">Edit</button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => setEditingId(null)} className="text-slate-500 text-sm hover:underline">Cancel</button>
                      <button onClick={saveEdit} className="bg-cyan-600 text-white px-3 py-1 rounded text-sm hover:bg-cyan-700">Save</button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg">
                     <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1">Min Workers</label>
                       <input type="number" className="w-full p-2 border rounded" value={editForm.minWorkers} onChange={e => setEditForm({...editForm, minWorkers: Number(e.target.value)})} />
                     </div>
                     <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1">Max Workers</label>
                       <input type="number" className="w-full p-2 border rounded" value={editForm.maxWorkers} onChange={e => setEditForm({...editForm, maxWorkers: Number(e.target.value)})} />
                     </div>
                     <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1">Setup Time (mins)</label>
                       <input type="number" className="w-full p-2 border rounded" value={editForm.setupTime} onChange={e => setEditForm({...editForm, setupTime: Number(e.target.value)})} />
                     </div>
                     <div className="md:col-span-2">
                       <label className="block text-xs font-bold text-slate-500 mb-1">Capacity Map (JSON: "workers": units/hr)</label>
                       <textarea 
                         className="w-full p-2 border rounded font-mono text-xs" 
                         rows={2}
                         value={editForm.capacityMapJSON} 
                         onChange={e => setEditForm({...editForm, capacityMapJSON: e.target.value})} 
                       />
                     </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-slate-400 block text-xs">Capacity Map</span>
                      <code className="bg-slate-100 px-2 py-1 rounded text-xs text-slate-600">{param?.capacityMapJSON || step.defaultCapacityMap}</code>
                    </div>
                    <div>
                       <span className="text-slate-400 block text-xs">Setup Time</span>
                       <span>{param?.setupTime || step.setupTime} mins</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const ReferenceCalculator = ({ user }) => {
   const { data: parameters } = useCollection('parameters', user);
   const { data: stocks } = useCollection('step_stocks', user);
   
   const [qty, setQty] = useState(1000);
   const [workers, setWorkers] = useState({});
   const [type, setType] = useState(PRODUCT_TYPES[0]);
   const [pm, setPm] = useState('Screen');
   const [hm, setHm] = useState('String');

   const relevantSteps = getProjectSteps(pm, hm);

   useEffect(() => {
     const init = {};
     ALL_STEPS_DEFINITIONS.forEach(s => init[s.id] = 1);
     setWorkers(init);
   }, []);

   return (
     <div className="max-w-4xl mx-auto space-y-6">
       <h2 className="text-2xl font-bold text-slate-800">Reference Calculator</h2>
       <p className="text-slate-500">Estimate production times for any quantity based on worker allocation.</p>

       <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
         <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
           <div className="md:col-span-4">
             <label className="block text-sm font-bold text-slate-700 mb-2">Product Type (To check stock)</label>
             <select value={type} onChange={e => setType(e.target.value)} className="w-full p-3 border rounded-lg">
                {PRODUCT_TYPES.map(t => <option key={t}>{t}</option>)}
             </select>
           </div>
           <div>
             <label className="block text-sm font-bold text-slate-700 mb-2">Target Quantity</label>
             <input type="number" value={qty} onChange={e => setQty(Number(e.target.value))} className="w-full p-3 border rounded-lg" />
           </div>
           <div>
             <label className="block text-sm font-bold text-slate-700 mb-2">Printing Method</label>
             <select value={pm} onChange={e => setPm(e.target.value)} className="w-full p-3 border rounded-lg">
               {PRINTING_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
             </select>
           </div>
           <div>
             <label className="block text-sm font-bold text-slate-700 mb-2">Hanging Method</label>
             <select value={hm} onChange={e => setHm(e.target.value)} className="w-full p-3 border rounded-lg">
               {HANGING_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
             </select>
           </div>
         </div>
       </div>

       <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cyan-50 text-cyan-800 border-b border-cyan-100">
              <tr>
                <th className="p-4 text-left">Step</th>
                <th className="p-4 text-left">Stock Available</th>
                <th className="p-4 text-left">Net Work Needed</th>
                <th className="p-4 text-left">Assigned Workers</th>
                <th className="p-4 text-left">Time Estimate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {relevantSteps.map(step => {
                const stockKey = getStockId(type, step.id);
                const available = stocks.find(s => s.id === stockKey)?.quantity || 0;
                
                // If stock covers target, work needed is 0
                const workNeeded = Math.max(0, qty - available);

                const assigned = workers[step.id] || 1;
                const capacity = getCapacityForWorkers(step, assigned, parameters);
                const hours = capacity > 0 ? (workNeeded / capacity).toFixed(2) : "N/A";
                
                return (
                  <tr key={step.id} className={workNeeded === 0 ? "bg-emerald-50 opacity-70" : ""}>
                    <td className="p-4 font-medium">{step.name}</td>
                    <td className="p-4 text-slate-500">{available.toLocaleString()}</td>
                    <td className="p-4 font-bold">{workNeeded.toLocaleString()}</td>
                    <td className="p-4">
                      {workNeeded > 0 ? (
                        <select 
                          className="p-1 border rounded bg-slate-50"
                          value={assigned}
                          onChange={e => setWorkers({...workers, [step.id]: Number(e.target.value)})}
                        >
                          {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      ) : <span className="text-xs text-emerald-600 font-bold">Stock Covered</span>}
                    </td>
                    <td className="p-4 font-mono font-bold text-cyan-600">{workNeeded > 0 ? `${hours} hrs` : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
       </div>
     </div>
   )
};

const WorkerManager = ({ user }) => {
  const { data: workers } = useCollection('workers', user);
  const [form, setForm] = useState({ name: '', type: 'Core', availability: ['Mon','Tue','Wed','Thu','Fri'] });

  const addWorker = async (e) => {
    e.preventDefault();
    if(!form.name) return;
    // Fixed: Using DB_PREFIX collection path
    await addDoc(collection(db, DB_PREFIX, 'workers'), form);
    setForm({...form, name: ''});
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-slate-800">Worker Roster</h2>
      
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
         <h3 className="font-bold mb-4">Add New Worker</h3>
         <form onSubmit={addWorker} className="flex gap-4 items-end">
           <div className="flex-1">
             <label className="block text-xs font-bold text-slate-500 mb-1">Name</label>
             <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full p-2 border rounded" placeholder="Name" />
           </div>
           <div className="w-40">
             <label className="block text-xs font-bold text-slate-500 mb-1">Type</label>
             <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="w-full p-2 border rounded">
               <option>Core</option>
               <option>Part-time</option>
               <option>Occasional</option>
             </select>
           </div>
           <button className="bg-cyan-600 text-white px-4 py-2 rounded hover:bg-cyan-700">Add</button>
         </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {workers.map(w => (
          <div key={w.id} className="bg-white p-4 rounded-xl border border-slate-200 flex justify-between items-center">
             <div>
               <div className="font-bold text-slate-800">{w.name}</div>
               <div className="text-xs text-slate-400">{w.availability?.join(', ')}</div>
             </div>
             <span className="px-2 py-1 bg-slate-100 rounded text-xs text-slate-600">{w.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default App;