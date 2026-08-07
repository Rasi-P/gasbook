import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { 
  Bell, 
  IndianRupee, 
  PackagePlus, 
  Flame,
  Home,
  Compass,
  MapPin,
  History,
  Gift,
  HelpCircle,
  ShieldAlert,
  User,
  Settings,
  Menu,
  X,
  Wrench,
  ChevronRight,
  PhoneCall,
  Clock,
  CheckCircle2,
  AlertTriangle,
  LogOut,
  Check
} from 'lucide-react';
import { api, logout } from '../../lib/api';

type CylinderType = { id: number; name: string; selling_price: number; weight: number; refill_rate: number };
type Rate = { cylinder_type: number; custom_price: string };
type Profile = {
  id: number;
  full_name: string;
  pending_amount: string;
  last_delivery_date: string | null;
  custom_rates: Rate[];
  phone: string;
  area: string;
  credit_limit: number;
  deposit_cylinders: number;
};
type Booking = {
  id: number;
  cylinder_type: number;
  cylinder_type_name: string;
  quantity: number;
  status: string;
  rate: string;
  created_at: string;
  note?: string;
};
type Notification = { id: number; title: string; body: string; is_read: boolean; created_at: string };

function money(v: number | string) {
  return `₹${Number(v || 0).toLocaleString('en-IN')}`;
}

export default function CustomerDashboard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [types, setTypes] = useState<CylinderType[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  
  // App navigation state
  const [activeTab, setActiveTab] = useState<'home' | 'connections' | 'book' | 'track' | 'history' | 'offers' | 'help' | 'profile' | 'settings'>('home');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);

  // Booking Flow Wizard State
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [bookingStep, setBookingStep] = useState(1);
  const [selectedCylinder, setSelectedCylinder] = useState<string>('');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [address, setAddress] = useState('');
  const [paymentMode, setPaymentMode] = useState<'cash' | 'gpay' | 'bank' | 'credit'>('cash');
  const [isBookingSubmitting, setIsBookingSubmitting] = useState(false);

  // Mechanic Flow State
  const [isMechanicOpen, setIsMechanicOpen] = useState(false);
  const [mechanicIssue, setMechanicIssue] = useState('gas_leak');
  const [mechanicTime, setMechanicTime] = useState('');
  const [mechanicNote, setMechanicNote] = useState('');
  const [mechanicSuccess, setMechanicSuccess] = useState(false);

  // Emergency Modal
  const [isEmergencyOpen, setIsEmergencyOpen] = useState(false);

  function load() {
    Promise.all([
      api.get('/customer-profiles/'),
      api.get('/cylinder-types/'),
      api.get('/bookings/'),
      api.get('/notifications/'),
    ]).then(([profileRes, typeRes, bookingRes, notificationRes]) => {
      const profileRows = profileRes.data.results ?? profileRes.data;
      const typeRows = typeRes.data.results ?? typeRes.data;
      setProfile(profileRows[0] || null);
      setTypes(typeRows);
      
      const bRows = bookingRes.data.results ?? bookingRes.data;
      setBookings(bRows);
      
      if (typeRows.length > 0 && !selectedCylinder) {
        setSelectedCylinder(String(typeRows[0]?.id || ''));
      }
      
      setNotifications(notificationRes.data.results ?? notificationRes.data);
      if (profileRows[0]) {
        setAddress(profileRows[0].area || 'Default registered home address');
      }
    }).catch(() => undefined);
  }

  useEffect(load, []);

  // Compute Active Booking for Tracking/Status Panel
  const activeBooking = useMemo(() => {
    // Return the latest booking that is not completed (Delivered/Rejected/Cancelled)
    return bookings.find(b => 
      !['delivered', 'rejected', 'cancelled'].includes(b.status.toLowerCase())
    ) || bookings[0] || null;
  }, [bookings]);

  // Compute pricing context
  const activeCylinderObj = useMemo(() => {
    return types.find(t => String(t.id) === selectedCylinder) || types[0];
  }, [types, selectedCylinder]);

  const pricingContext = useMemo(() => {
    if (!activeCylinderObj) return { standard: 0, special: 0, savings: 0, hasCustom: false };
    const custom = profile?.custom_rates.find(r => r.cylinder_type === activeCylinderObj.id);
    const standard = activeCylinderObj.selling_price;
    const special = custom ? Number(custom.custom_price) : standard;
    const savings = standard - special;
    return {
      standard,
      special,
      savings,
      hasCustom: !!custom
    };
  }, [activeCylinderObj, profile]);

  const activeRatesPanelValues = useMemo(() => {
    if (types.length === 0) return { standard: 980, special: 930, savings: 50 };
    const mainType = types[0];
    const custom = profile?.custom_rates.find(r => r.cylinder_type === mainType.id);
    const standard = mainType.selling_price;
    const special = custom ? Number(custom.custom_price) : standard;
    return {
      standard,
      special,
      savings: standard - special,
      name: mainType.name
    };
  }, [types, profile]);

  // Status Step Helper
  const statusStepIndex = useMemo(() => {
    if (!activeBooking) return 0;
    const s = activeBooking.status.toLowerCase();
    if (s === 'pending') return 1;
    if (s === 'approved') return 2;
    if (s.includes('pack')) return 3;
    if (s.includes('out_for_delivery') || s.includes('transit') || s.includes('dispatch') || s.includes('delivery')) return 4;
    if (s === 'delivered') return 5;
    return 1;
  }, [activeBooking]);

  // Handle Refill Booking API request
  async function handleBookRefill(e?: FormEvent) {
    if (e) e.preventDefault();
    setIsBookingSubmitting(true);
    try {
      await api.post('/bookings/', {
        cylinder_type: Number(selectedCylinder),
        quantity,
        note: note ? `${note} (Deliver to: ${address})` : `Deliver to: ${address}`
      });
      setBookingStep(5); // Success step
      load();
    } catch {
      alert('Failed to place booking request. Please try again.');
    } finally {
      setIsBookingSubmitting(false);
    }
  }

  // Handle Mechanic Booking
  function handleMechanicSubmit(e: FormEvent) {
    e.preventDefault();
    setMechanicSuccess(true);
    setTimeout(() => {
      setIsMechanicOpen(false);
      setMechanicSuccess(false);
      setMechanicNote('');
      setMechanicTime('');
    }, 2000);
  }

  // Render SVG Red Cylinder
  const renderCylinderSVG = (className = "h-48 w-auto") => (
    <svg className={className} viewBox="0 0 200 300" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Cylinder Shadow */}
      <ellipse cx="100" cy="270" rx="60" ry="12" fill="#E2E8F0" opacity="0.8" />
      {/* Main Cylinder Body */}
      <path d="M50 90C50 70 65 50 100 50C135 50 150 70 150 90V230C150 255 128 265 100 265C72 265 50 255 50 230V90Z" fill="url(#cylinder_grad)" />
      {/* Weld lines & highlights */}
      <path d="M50 160C80 170 120 170 150 160" stroke="#DC2626" strokeWidth="2" opacity="0.4" />
      {/* Shading/Glow effect */}
      <path d="M50 90C55 160 55 200 50 230" stroke="#FFF" strokeWidth="4" opacity="0.15" strokeLinecap="round" />
      {/* Cylinder Cap / Neck collar */}
      <path d="M70 50C70 35 80 30 100 30C120 30 130 35 130 50" stroke="#94A3B8" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M85 30H115V22H85V30Z" fill="#475569" />
      {/* Inner Valve */}
      <circle cx="100" cy="16" r="6" fill="#F97316" />
      {/* Handles */}
      <path d="M62 48C50 48 50 75 60 85" stroke="#94A3B8" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M138 48C150 48 150 75 140 85" stroke="#94A3B8" strokeWidth="6" fill="none" strokeLinecap="round" />
      {/* Flame Logo Graphic */}
      <path d="M100 110C100 110 85 130 85 145C85 153.284 91.7157 160 100 160C108.284 160 115 153.284 115 145C115 130 100 110 100 110Z" fill="#FFF" opacity="0.9" />
      <path d="M100 122C100 122 92 135 92 144C92 148.971 95.5817 153 100 153C104.418 153 108 148.971 108 144C108 135 100 122 100 122Z" fill="#F97316" />
      {/* Gradients */}
      <defs>
        <linearGradient id="cylinder_grad" x1="50" y1="150" x2="150" y2="150" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#EA580C" />
          <stop offset="45%" stopColor="#EF4444" />
          <stop offset="70%" stopColor="#DC2626" />
          <stop offset="100%" stopColor="#991B1B" />
        </linearGradient>
      </defs>
    </svg>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex text-[#1E293B] antialiased" style={{ fontFamily: '"Inter", sans-serif' }}>
      
      {/* 1. SIDEBAR (DESKTOP) */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-[#E2E8F0] fixed top-0 bottom-0 left-0 p-6 z-30 transition-all">
        <div className="flex items-center gap-2 mb-8">
          <div className="bg-[#F97316] text-white p-2 rounded-xl shadow-md shadow-orange-500/20">
            <Flame size={24} className="animate-pulse" />
          </div>
          <span className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-orange-500 to-red-600 bg-clip-text text-transparent">
            GasBook
          </span>
        </div>

        <nav className="flex-1 space-y-1">
          {[
            { id: 'home', label: 'Home', icon: Home },
            { id: 'connections', label: 'My Connections', icon: Compass },
            { id: 'book', label: 'Book Cylinder', icon: PackagePlus, action: () => setIsBookingOpen(true) },
            { id: 'track', label: 'Track Order', icon: MapPin },
            { id: 'history', label: 'Booking History', icon: History },
            { id: 'offers', label: 'Offers & Rewards', icon: Gift },
            { id: 'help', label: 'Help & Support', icon: HelpCircle },
            { id: 'profile', label: 'Profile', icon: User },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.action) {
                    item.action();
                  } else {
                    setActiveTab(item.id as any);
                  }
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                  isActive 
                    ? 'bg-[#EFF6FF] text-[#2563EB] shadow-sm' 
                    : 'text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#1E293B]'
                }`}
              >
                <Icon size={18} className={isActive ? 'text-[#2563EB]' : 'text-[#64748B]'} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar Rates Widget */}
        <div className="mt-auto bg-gradient-to-br from-green-50/80 to-emerald-50/50 border border-green-100 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="bg-emerald-500 text-white p-1 rounded-full text-xs">
              <Check size={10} strokeWidth={3} />
            </span>
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Today's Special Rate</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-[#64748B]">{activeRatesPanelValues.name || 'Domestic'} Standard</span>
              <span className="text-xs line-through text-[#94A3B8]">{money(activeRatesPanelValues.standard)}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-sm font-extrabold text-[#1E293B]">Your Special Price</span>
              <span className="text-base font-extrabold text-emerald-600">{money(activeRatesPanelValues.special)}</span>
            </div>
            {activeRatesPanelValues.savings > 0 && (
              <div className="pt-1.5 border-t border-green-200/50 flex justify-between items-center text-xs font-bold text-emerald-700">
                <span>You Save</span>
                <span className="bg-emerald-500/10 px-1.5 py-0.5 rounded">🎉 {money(activeRatesPanelValues.savings)}</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* 2. MAIN CONTENT AREA */}
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        
        {/* TOPBAR */}
        <header className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-[#E2E8F0] h-16 flex items-center justify-between px-6 z-20">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 hover:bg-[#F1F5F9] rounded-lg text-[#64748B]"
            >
              <Menu size={20} />
            </button>
            <div className="hidden sm:block">
              <h2 className="text-lg font-bold text-[#1E293B]">
                Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'}, {profile?.full_name || 'Guest'} 👋
              </h2>
              <p className="text-xs text-[#64748B]">Let's manage your LPG refills and connection accounts.</p>
            </div>
            <div className="sm:hidden flex items-center gap-2">
              <Flame size={20} className="text-[#F97316]" />
              <span className="font-extrabold text-base tracking-tight">GasBook</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Notification Bell */}
            <div className="relative">
              <button 
                onClick={() => setActiveTab('home')}
                className="p-2.5 hover:bg-[#F1F5F9] rounded-xl text-[#64748B] relative transition-colors"
              >
                <Bell size={20} />
                {notifications.filter(n => !n.is_read).length > 0 && (
                  <span className="absolute top-1 right-1 bg-[#EF4444] text-white text-[10px] font-extrabold w-4 h-4 flex items-center justify-center rounded-full border-2 border-white">
                    {notifications.filter(n => !n.is_read).length}
                  </span>
                )}
              </button>
            </div>

            {/* Profile Dropdown */}
            <div className="relative">
              <button 
                onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
                className="flex items-center gap-2 hover:bg-[#F1F5F9] p-1.5 pr-3 rounded-xl transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-orange-400 to-[#F97316] text-white flex items-center justify-center font-bold text-sm shadow-sm">
                  {(profile?.full_name || 'U').slice(0, 2).toUpperCase()}
                </div>
                <span className="hidden sm:block text-sm font-bold text-[#334155]">
                  {profile?.full_name.split(' ')[0] || 'My Account'}
                </span>
              </button>

              {isProfileDropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-[#E2E8F0] rounded-xl shadow-xl py-1 z-50">
                  <button 
                    onClick={() => { setActiveTab('profile'); setIsProfileDropdownOpen(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#F1F5F9] flex items-center gap-2 text-[#334155] font-medium"
                  >
                    <User size={16} /> Profile
                  </button>
                  <button 
                    onClick={() => { setActiveTab('settings'); setIsProfileDropdownOpen(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#F1F5F9] flex items-center gap-2 text-[#334155] font-medium"
                  >
                    <Settings size={16} /> Change Password
                  </button>
                  <hr className="border-[#F1F5F9] my-1" />
                  <button 
                    onClick={() => { logout(); window.location.href = '/login'; }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-red-50 flex items-center gap-2 text-red-650 font-semibold"
                  >
                    <LogOut size={16} /> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* CONTAINER FOR TABS */}
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6 pb-20">
          
          {activeTab === 'home' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* LEFT DASHBOARD COLUMN */}
              <div className="lg:col-span-8 space-y-6">
                
                {/* HERO CARD */}
                <div className="bg-gradient-to-br from-blue-550 to-blue-650 bg-[#2563EB] text-white rounded-3xl p-6 relative overflow-hidden shadow-lg shadow-blue-500/20">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-400/20 via-transparent to-transparent opacity-60 pointer-events-none" />
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <span className="bg-blue-400/30 px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase text-blue-100 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-green-400 animate-ping" />
                          My Connection Active
                        </span>
                      </div>
                      <div>
                        <h3 className="text-2xl font-extrabold tracking-tight">
                          {profile?.custom_rates[0]?.cylinder_type 
                            ? types.find(t => t.id === profile.custom_rates[0].cylinder_type)?.name 
                            : types[0]?.name || 'Domestic 14.2 KG'}
                        </h3>
                        <p className="text-blue-100/90 text-sm mt-1">
                          Last cylinder delivery: <span className="font-bold text-white">{profile?.last_delivery_date ? new Date(profile.last_delivery_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : 'No records yet'}</span>
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-3 pt-2">
                        <button 
                          onClick={() => {
                            if (types.length > 0) {
                              setSelectedCylinder(String(types[0].id));
                            }
                            setBookingStep(1);
                            setIsBookingOpen(true);
                          }}
                          className="bg-white hover:bg-orange-50 text-[#2563EB] hover:text-[#F97316] font-bold px-6 py-3 rounded-2xl shadow-md transition-all duration-200 flex items-center gap-2 hover:scale-[1.02]"
                        >
                          <PackagePlus size={18} /> Book Cylinder
                        </button>
                        {activeBooking && (
                          <button 
                            onClick={() => setActiveTab('track')}
                            className="bg-transparent hover:bg-white/10 border border-white/40 text-white font-bold px-5 py-3 rounded-2xl transition-all duration-200 flex items-center gap-2"
                          >
                            <MapPin size={18} /> Track Order
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="hidden md:flex justify-center flex-1 max-w-[200px]">
                      {renderCylinderSVG("h-48 w-auto filter drop-shadow-xl hover:rotate-3 transition-transform duration-300")}
                    </div>
                  </div>
                </div>

                {/* QUICK ACTIONS GRID */}
                <div>
                  <h3 className="text-base font-bold text-[#334155] mb-4 flex items-center gap-2">
                    Quick Actions
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: 'Book Cylinder', icon: PackagePlus, color: 'bg-orange-50 text-orange-600', action: () => setIsBookingOpen(true) },
                      { label: 'Track Order', icon: MapPin, color: 'bg-blue-50 text-blue-600', action: () => setActiveTab('track') },
                      { label: 'Booking History', icon: History, color: 'bg-purple-50 text-purple-600', action: () => setActiveTab('history') },
                      { label: 'Help & Support', icon: HelpCircle, color: 'bg-cyan-50 text-cyan-600', action: () => setActiveTab('help') },
                      { label: 'Request Mechanic', icon: Wrench, color: 'bg-amber-50 text-amber-600', action: () => setIsMechanicOpen(true) },
                      { label: 'Offers & Rewards', icon: Gift, color: 'bg-pink-50 text-pink-600', action: () => setActiveTab('offers') },
                      { label: 'Emergency (SOS)', icon: ShieldAlert, color: 'bg-red-50 text-red-600', action: () => setIsEmergencyOpen(true) },
                      { label: 'My Profile', icon: User, color: 'bg-emerald-50 text-emerald-600', action: () => setActiveTab('profile') },
                    ].map((act, i) => {
                      const Icon = act.icon;
                      return (
                        <button
                          key={i}
                          onClick={act.action}
                          className="bg-white border border-[#E2E8F0] hover:border-orange-200 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-3 transition-all duration-200 hover:shadow-md hover:scale-[1.02] group"
                        >
                          <div className={`p-3 rounded-xl ${act.color} group-hover:scale-110 transition-transform`}>
                            <Icon size={20} />
                          </div>
                          <span className="text-xs font-bold text-[#475569] group-hover:text-black">
                            {act.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* RECENT BOOKINGS TIMELINE LIST */}
                <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 shadow-sm">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-base font-bold text-[#334155]">Recent Bookings</h3>
                    <button 
                      onClick={() => setActiveTab('history')}
                      className="text-xs font-bold text-[#2563EB] hover:underline"
                    >
                      View All
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    {bookings.slice(0, 3).map((b) => (
                      <div key={b.id} className="flex items-center justify-between p-4 border border-[#F1F5F9] rounded-2xl hover:bg-[#F8FAFC] transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="bg-orange-50 p-2.5 rounded-xl text-[#F97316]">
                            <Flame size={18} />
                          </div>
                          <div>
                            <span className="text-xs font-bold text-[#64748B]">Booking #{b.id}</span>
                            <h4 className="text-sm font-bold text-[#1E293B]">{b.quantity} x {b.cylinder_type_name}</h4>
                            <p className="text-xs text-[#94A3B8]">{new Date(b.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-extrabold text-[#1E293B] block">{money(b.rate)}</span>
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase mt-1 ${
                            b.status.toLowerCase() === 'delivered' 
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                              : ['rejected', 'cancelled'].includes(b.status.toLowerCase())
                              ? 'bg-red-50 text-red-600 border border-red-100' 
                              : 'bg-amber-50 text-amber-600 border border-amber-100'
                          }`}>
                            {b.status.replaceAll('_', ' ')}
                          </span>
                        </div>
                      </div>
                    ))}
                    {bookings.length === 0 && (
                      <p className="text-center text-sm text-[#94A3B8] py-6">No refill history found.</p>
                    )}
                  </div>
                </div>

              </div>

              {/* RIGHT DASHBOARD COLUMN */}
              <div className="lg:col-span-4 space-y-6">
                
                {/* ACTIVE ORDER CARD & TIMELINE */}
                {activeBooking && (
                  <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="text-sm font-extrabold text-[#334155] uppercase tracking-wider">Active Booking</h4>
                      <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">
                        #{activeBooking.id}
                      </span>
                    </div>

                    <div className="bg-gradient-to-r from-orange-50 to-orange-100/50 border border-orange-100 rounded-2xl p-4 mb-4">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-[10px] font-bold text-orange-600 uppercase tracking-wide">Status Update</span>
                          <h5 className="text-base font-extrabold text-orange-950 capitalize">{activeBooking.status.replaceAll('_', ' ')}</h5>
                        </div>
                        <button 
                          onClick={() => setActiveTab('track')}
                          className="bg-[#F97316] text-white p-2 rounded-xl text-xs font-bold hover:bg-orange-600 transition-colors"
                        >
                          Live Track
                        </button>
                      </div>
                    </div>

                    {/* Timeline stepper */}
                    <div className="relative pl-6 space-y-5 border-l-2 border-[#E2E8F0] ml-3">
                      {[
                        { label: 'Booking Filed', desc: 'Refill request submitted by you', step: 1 },
                        { label: 'Approved by Dealer', desc: 'Request validated', step: 2 },
                        { label: 'Cylinder Packed', desc: 'Cylinder assigned & sealed', step: 3 },
                        { label: 'Out for Delivery', desc: 'Dispatched with delivery vehicle', step: 4 },
                        { label: 'Delivered', desc: 'Handed over & payment synced', step: 5 }
                      ].map((step, idx) => {
                        const isDone = statusStepIndex >= step.step;
                        const isCurrent = statusStepIndex === step.step;
                        return (
                          <div key={idx} className="relative">
                            {/* Bullet dot */}
                            <span className={`absolute -left-[31px] top-1 w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
                              isDone 
                                ? 'bg-orange-500 border-orange-500 text-white' 
                                : 'bg-white border-[#CBD5E1] text-transparent'
                            }`}>
                              {isDone && <Check size={10} strokeWidth={3} />}
                            </span>
                            <div>
                              <h6 className={`text-xs font-bold ${isCurrent ? 'text-orange-600' : isDone ? 'text-[#1E293B]' : 'text-[#94A3B8]'}`}>
                                {step.label}
                              </h6>
                              <p className="text-[10px] text-[#64748B] mt-0.5">{step.desc}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* PRICE CARD */}
                <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 shadow-sm relative overflow-hidden">
                  <div className="absolute right-[-20px] top-[-20px] w-24 h-24 bg-green-500/10 rounded-full flex items-center justify-center">
                    <IndianRupee className="text-green-600 opacity-20" size={48} />
                  </div>
                  <h4 className="text-sm font-extrabold text-[#334155] mb-4">LPG Refill Pricing</h4>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm border-b border-[#F1F5F9] pb-2">
                      <span className="text-[#64748B]">Today's Standard Price</span>
                      <span className="font-semibold text-[#475569]">{money(pricingContext.standard)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-[#1E293B]">Your Special Account Price</span>
                      <span className="text-base font-extrabold text-[#22C55E]">
                        {money(pricingContext.special)}
                      </span>
                    </div>
                    
                    {pricingContext.savings > 0 && (
                      <div className="bg-green-50 border border-green-100 rounded-xl p-3 flex items-center justify-between text-xs font-bold text-green-700">
                        <span>Direct Savings Badge</span>
                        <span className="bg-green-500 text-white px-2 py-0.5 rounded-full text-[10px] animate-bounce">
                          Save {money(pricingContext.savings)} 🎉
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* LIVE DISPATCH UPDATES / NOTIFICATIONS */}
                <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 shadow-sm">
                  <h4 className="text-sm font-extrabold text-[#334155] mb-4 flex items-center gap-1.5">
                    <Bell size={16} className="text-[#2563EB]" /> Live Dispatch Updates
                  </h4>
                  <div className="space-y-4 max-h-[220px] overflow-y-auto pr-1">
                    {notifications.slice(0, 4).map((n) => (
                      <div key={n.id} className="relative flex gap-3 pb-2 border-b border-[#F8FAFC]">
                        <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.is_read ? 'bg-[#94A3B8]' : 'bg-[#2563EB]'}`} />
                        <div>
                          <h6 className="text-xs font-bold text-[#334155]">{n.title}</h6>
                          <p className="text-[11px] text-[#64748B] mt-0.5">{n.body}</p>
                        </div>
                      </div>
                    ))}
                    {notifications.length === 0 && (
                      <p className="text-center text-xs text-[#94A3B8] py-4">No new delivery updates.</p>
                    )}
                  </div>
                </div>

                {/* NEED HELP & SUPPORT CARD */}
                <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 shadow-sm">
                  <h4 className="text-sm font-extrabold text-[#334155] mb-3">Need Assistance?</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setIsMechanicOpen(true)}
                      className="p-3 bg-slate-50 hover:bg-[#F1F5F9] border border-slate-100 rounded-xl text-center flex flex-col items-center gap-1.5 transition-colors"
                    >
                      <Wrench size={16} className="text-[#F97316]" />
                      <span className="text-[11px] font-bold text-[#475569]">Mechanic</span>
                    </button>
                    <button 
                      onClick={() => setIsEmergencyOpen(true)}
                      className="p-3 bg-red-50 hover:bg-red-100/75 border border-red-100 rounded-xl text-center flex flex-col items-center gap-1.5 transition-colors"
                    >
                      <ShieldAlert size={16} className="text-red-500" />
                      <span className="text-[11px] font-bold text-red-600">Emergency</span>
                    </button>
                    <a 
                      href={`tel:${profile?.phone || '1906'}`}
                      className="p-3 bg-slate-50 hover:bg-[#F1F5F9] border border-slate-100 rounded-xl text-center flex flex-col items-center gap-1.5 transition-colors"
                    >
                      <PhoneCall size={16} className="text-[#2563EB]" />
                      <span className="text-[11px] font-bold text-[#475569]">Dealer Help</span>
                    </a>
                    <button 
                      onClick={() => setActiveTab('help')}
                      className="p-3 bg-slate-50 hover:bg-[#F1F5F9] border border-slate-100 rounded-xl text-center flex flex-col items-center gap-1.5 transition-colors"
                    >
                      <HelpCircle size={16} className="text-purple-500" />
                      <span className="text-[11px] font-bold text-[#475569]">Chat Support</span>
                    </button>
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* 3. TRACK TAB */}
          {activeTab === 'track' && (
            <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 md:p-8 shadow-sm">
              <h2 className="text-2xl font-bold tracking-tight mb-2">Live Refill Tracking</h2>
              <p className="text-sm text-[#64748B] mb-6">Track your cylinder delivery driver in real-time.</p>

              {activeBooking ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Driver and timeline info */}
                  <div className="lg:col-span-5 space-y-6">
                    
                    <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-2xl p-5 flex items-center gap-4">
                      <div className="p-3 bg-[#2563EB] text-white rounded-xl">
                        <MapPin size={24} className="animate-bounce" />
                      </div>
                      <div>
                        <span className="text-xs text-[#2563EB] font-bold uppercase tracking-wider">Estimated Refill Time</span>
                        <h4 className="text-xl font-black text-[#1E293B]">Today, within 2 hours</h4>
                        <p className="text-xs text-[#64748B]">Driver matches your area: <strong className="text-black">{profile?.area || 'Assigned Zone'}</strong></p>
                      </div>
                    </div>

                    {/* Driver details */}
                    <div className="border border-[#E2E8F0] rounded-2xl p-5">
                      <h4 className="text-xs font-bold text-[#94A3B8] uppercase tracking-wide mb-3">Delivery Partner</h4>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-700 border border-slate-200">
                            DK
                          </div>
                          <div>
                            <h5 className="font-extrabold text-[#1E293B]">Ramesh Kumar</h5>
                            <p className="text-xs text-[#64748B] flex items-center gap-1 mt-0.5">
                              <Clock size={12} /> Checked in at Local Hub
                            </p>
                          </div>
                        </div>
                        <a 
                          href="tel:+919876543210" 
                          className="bg-[#2563EB] hover:bg-blue-600 text-white p-3 rounded-xl transition-colors"
                        >
                          <PhoneCall size={18} />
                        </a>
                      </div>
                    </div>

                    {/* Booking metadata */}
                    <div className="border border-[#E2E8F0] rounded-2xl p-5 space-y-3">
                      <h4 className="text-xs font-bold text-[#94A3B8] uppercase tracking-wide">Order Specifications</h4>
                      <div className="flex justify-between text-sm">
                        <span className="text-[#64748B]">Booking Number</span>
                        <span className="font-bold text-[#1E293B]">#{activeBooking.id}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-[#64748B]">Cylinder Size</span>
                        <span className="font-bold text-[#1E293B]">{activeBooking.cylinder_type_name}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-[#64748B]">Refill Quantity</span>
                        <span className="font-bold text-[#1E293B]">{activeBooking.quantity} unit(s)</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-[#64748B]">Due Charges</span>
                        <span className="font-extrabold text-[#22C55E]">{money(activeBooking.rate)}</span>
                      </div>
                    </div>

                  </div>

                  {/* Simulator Map (SVG/CSS animation showing delivery truck moving) */}
                  <div className="lg:col-span-7 flex flex-col justify-between border border-[#E2E8F0] rounded-2xl p-6 bg-slate-50 min-h-[350px]">
                    <div>
                      <h4 className="text-xs font-bold text-[#94A3B8] uppercase tracking-wide mb-2">Refill Journey Map</h4>
                      <p className="text-xs text-[#64748B]">Visual simulator based on live dispatch state.</p>
                    </div>

                    {/* Styled Delivery Path */}
                    <div className="relative py-12 flex flex-col items-center justify-center">
                      <div className="w-full h-2.5 bg-slate-200 rounded-full relative overflow-hidden">
                        {/* Orange progress bar matching active step */}
                        <div 
                          className="h-full bg-gradient-to-r from-orange-400 to-[#F97316] transition-all duration-1000"
                          style={{ width: `${(statusStepIndex - 1) * 25}%` }}
                        />
                      </div>

                      {/* Moving Truck Icon */}
                      <div 
                        className="absolute top-4 transition-all duration-1000 transform -translate-x-1/2 flex flex-col items-center"
                        style={{ left: `${(statusStepIndex - 1) * 25}%` }}
                      >
                        <div className="bg-[#F97316] text-white p-2.5 rounded-full shadow-lg shadow-orange-500/25 border-2 border-white animate-bounce">
                          <Flame size={20} />
                        </div>
                        <span className="text-[10px] font-bold text-orange-600 bg-white border border-orange-100 px-1.5 py-0.5 rounded-md mt-1 shadow-sm whitespace-nowrap">
                          Delivery Agent
                        </span>
                      </div>

                      {/* Path endpoints */}
                      <div className="w-full flex justify-between mt-4 px-2">
                        <div className="text-center">
                          <strong className="text-xs text-[#334155] block">Dealer Hub</strong>
                          <span className="text-[10px] text-[#64748B]">Dispatched</span>
                        </div>
                        <div className="text-center">
                          <strong className="text-xs text-[#334155] block">In Transit</strong>
                          <span className="text-[10px] text-[#64748B]">Your Area</span>
                        </div>
                        <div className="text-center">
                          <strong className="text-xs text-[#334155] block">Arrived</strong>
                          <span className="text-[10px] text-[#64748B]">Refill Done</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white border border-[#E2E8F0] p-4 rounded-xl flex items-center justify-between text-xs text-[#64748B]">
                      <span>Current Address: <strong className="text-black">{profile?.area || 'Main City Area'}</strong></span>
                      <span className="flex items-center gap-1.5"><Clock size={14} /> Refreshed 30s ago</span>
                    </div>

                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <PackagePlus size={48} className="mx-auto text-slate-300 mb-3" />
                  <h4 className="text-base font-bold text-[#334155]">No Active Refill Booking</h4>
                  <p className="text-xs text-[#64748B] max-w-sm mx-auto mt-1 mb-4">You do not have any active delivery bookings at the moment.</p>
                  <button 
                    onClick={() => setIsBookingOpen(true)}
                    className="bg-[#2563EB] hover:bg-blue-600 text-white font-bold px-6 py-2.5 rounded-xl text-sm"
                  >
                    Book a Refill Now
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 4. MY CONNECTIONS TAB */}
          {activeTab === 'connections' && (
            <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 md:p-8 shadow-sm">
              <h2 className="text-2xl font-bold tracking-tight mb-2">My LPG Connection</h2>
              <p className="text-sm text-[#64748B] mb-6">Manage cylinder configuration, deposits, and special rates.</p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-slate-50 border border-slate-100 p-5 rounded-2xl">
                  <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider block">Registered Name</span>
                  <strong className="text-lg text-[#1E293B] block mt-1">{profile?.full_name || 'Guest User'}</strong>
                </div>
                <div className="bg-slate-50 border border-slate-100 p-5 rounded-2xl">
                  <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider block">Service Area Zone</span>
                  <strong className="text-lg text-[#1E293B] block mt-1">{profile?.area || '—'}</strong>
                </div>
                <div className="bg-slate-50 border border-slate-100 p-5 rounded-2xl">
                  <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider block">Account Cylinder Deposits</span>
                  <strong className="text-lg text-[#1E293B] block mt-1">{profile?.deposit_cylinders || 0} unit(s)</strong>
                </div>
              </div>

              <div className="border border-[#E2E8F0] rounded-2xl overflow-hidden">
                <div className="bg-[#F8FAFC] border-b border-[#E2E8F0] px-6 py-4">
                  <h4 className="text-sm font-extrabold text-[#334155]">Standard Price vs. Your Account Special Pricing</h4>
                </div>
                <div className="divide-y divide-[#E2E8F0]">
                  {types.map((t) => {
                    const custom = profile?.custom_rates.find(r => r.cylinder_type === t.id);
                    return (
                      <div key={t.id} className="flex justify-between items-center px-6 py-4 hover:bg-[#F8FAFC]">
                        <div>
                          <h5 className="font-extrabold text-[#1E293B]">{t.name}</h5>
                          <span className="text-xs text-[#64748B]">Refill Rate: {money(t.refill_rate)}</span>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <span className="text-xs text-[#94A3B8] block">Standard</span>
                            <span className="font-semibold text-[#475569]">{money(t.selling_price)}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-xs text-[#94A3B8] block">Your Rate</span>
                            {custom ? (
                              <span className="bg-[#EFF6FF] border border-[#BFDBFE] text-[#2563EB] text-sm font-extrabold px-3 py-1 rounded-xl">
                                {money(custom.custom_price)}
                              </span>
                            ) : (
                              <span className="text-sm font-bold text-[#475569]">Standard Price</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 5. BOOKING HISTORY TAB */}
          {activeTab === 'history' && (
            <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 md:p-8 shadow-sm">
              <h2 className="text-2xl font-bold tracking-tight mb-2">Booking History</h2>
              <p className="text-sm text-[#64748B] mb-6">Complete log of all LPG cylinder orders, dispatch logs, and payments.</p>

              <div className="space-y-4">
                {bookings.map((b) => (
                  <div key={b.id} className="border border-[#E2E8F0] rounded-2xl p-5 hover:border-slate-350 transition-colors">
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="bg-[#EFF6FF] text-[#2563EB] text-xs font-extrabold px-3 py-0.5 rounded-full">
                            Booking #{b.id}
                          </span>
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            b.status.toLowerCase() === 'delivered' 
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                              : ['rejected', 'cancelled'].includes(b.status.toLowerCase())
                              ? 'bg-red-50 text-red-600 border border-red-100' 
                              : 'bg-amber-50 text-amber-600 border border-amber-100'
                          }`}>
                            {b.status.replaceAll('_', ' ')}
                          </span>
                        </div>
                        <h4 className="text-base font-extrabold text-[#1E293B] mt-2">
                          {b.quantity} x {b.cylinder_type_name}
                        </h4>
                        <p className="text-xs text-[#64748B] mt-0.5">
                          Order Date: <span className="font-semibold">{new Date(b.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        </p>
                        {b.note && (
                          <p className="text-xs text-[#94A3B8] italic mt-1.5">
                            Note: "{b.note}"
                          </p>
                        )}
                      </div>
                      <div className="sm:text-right">
                        <span className="text-xs text-[#64748B] block">Billing Amount</span>
                        <strong className="text-lg text-[#1E293B] font-extrabold block">{money(b.rate)} each</strong>
                        <span className="text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded mt-1.5 inline-block">
                          Total: {money(Number(b.rate) * b.quantity)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {bookings.length === 0 && (
                  <p className="text-center text-sm text-[#94A3B8] py-12">No orders recorded.</p>
                )}
              </div>
            </div>
          )}

          {/* 6. HELP & SUPPORT TAB */}
          {activeTab === 'help' && (
            <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 md:p-8 shadow-sm">
              <h2 className="text-2xl font-bold tracking-tight mb-2">Help & Support Center</h2>
              <p className="text-sm text-[#64748B] mb-6">Contact the team, request safety checks, or request a service mechanic.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                <div className="border border-[#E2E8F0] rounded-2xl p-6 space-y-4">
                  <h3 className="text-lg font-bold text-[#1E293B] flex items-center gap-2">
                    <Wrench className="text-orange-500" /> Book Visit by LPG Mechanic
                  </h3>
                  <p className="text-xs text-[#64748B]">Request help for cylinder connections, pipe issues, regulators, or low flames.</p>
                  <button 
                    onClick={() => setIsMechanicOpen(true)}
                    className="bg-[#2563EB] hover:bg-blue-600 text-white font-bold px-5 py-3 rounded-xl text-xs w-full transition-colors"
                  >
                    Schedule Mechanic Appointment
                  </button>
                </div>

                <div className="border border-[#E2E8F0] rounded-2xl p-6 space-y-4">
                  <h3 className="text-lg font-bold text-red-600 flex items-center gap-2">
                    <ShieldAlert /> Emergency Safety Support
                  </h3>
                  <p className="text-xs text-[#64748B]">Immediate instructions in case of gas leaks or safety issues. Available 24x7.</p>
                  <button 
                    onClick={() => setIsEmergencyOpen(true)}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold px-5 py-3 rounded-xl text-xs w-full transition-colors"
                  >
                    View Emergency Contacts
                  </button>
                </div>

                <div className="border border-[#E2E8F0] rounded-2xl p-6 space-y-4 md:col-span-2">
                  <h3 className="text-lg font-bold text-[#1E293B]">Frequently Asked Questions (FAQ)</h3>
                  <div className="space-y-3">
                    {[
                      { q: 'How do I request a refill?', a: 'Click the "Book Cylinder" button, choose your cylinder size and quantity, and click send. It takes less than 30 seconds.' },
                      { q: 'How is the payment processed?', a: 'Currently we support Cash on Delivery, GPay, and credit ledgers through your local distributor.' },
                      { q: 'What is a "Special Price"?', a: 'It is a discounted price specifically configured for your business or account by the main distributor.' }
                    ].map((faq, idx) => (
                      <div key={idx} className="bg-slate-50 p-4 rounded-xl">
                        <strong className="text-xs text-[#1E293B] block">{faq.q}</strong>
                        <p className="text-xs text-[#64748B] mt-1">{faq.a}</p>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* 7. OFFERS & REWARDS TAB */}
          {activeTab === 'offers' && (
            <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 md:p-8 shadow-sm">
              <h2 className="text-2xl font-bold tracking-tight mb-2">Offers & Rewards</h2>
              <p className="text-sm text-[#64748B] mb-6">Exclusive deals, referral discounts, and cylinder promotion rates.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                <div className="bg-gradient-to-br from-amber-400 to-orange-500 text-white p-6 rounded-2xl relative overflow-hidden shadow-md">
                  <h3 className="text-lg font-extrabold mb-1">Referral Reward</h3>
                  <p className="text-xs text-orange-55 mb-4">Refer a business or family and get ₹100 flat discount coupon on your next booking.</p>
                  <span className="bg-white text-orange-600 text-xs font-bold px-3 py-1.5 rounded-lg inline-block uppercase tracking-wider">
                    Code: REFER100
                  </span>
                </div>

                <div className="bg-gradient-to-br from-blue-500 to-[#2563EB] text-white p-6 rounded-2xl relative overflow-hidden shadow-md">
                  <h3 className="text-lg font-extrabold mb-1">Commercial Bulk Special</h3>
                  <p className="text-xs text-blue-50 mb-4">Get custom discounted pricing on monthly volumes above 10 cylinders. Contact admin.</p>
                  <button 
                    onClick={() => setActiveTab('help')}
                    className="bg-white text-blue-600 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors hover:bg-blue-50"
                  >
                    Inquire Now
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* 8. PROFILE SUMMARY TAB */}
          {activeTab === 'profile' && (
            <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 md:p-8 shadow-sm">
              <h2 className="text-2xl font-bold tracking-tight mb-2">My Account Profile</h2>
              <p className="text-sm text-[#64748B] mb-6">View user credentials, ledger settings, outstanding amounts, and assigned staff.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                <div className="border border-[#E2E8F0] p-5 rounded-2xl space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[#94A3B8]">Personal Information</h3>
                  <div className="space-y-2.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-[#64748B]">Customer Name</span>
                      <strong className="text-[#1E293B]">{profile?.full_name || '—'}</strong>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#64748B]">Contact Phone</span>
                      <strong className="text-[#1E293B]">{profile?.phone || '—'}</strong>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#64748B]">Registered Address Zone</span>
                      <strong className="text-[#1E293B]">{profile?.area || '—'}</strong>
                    </div>
                  </div>
                </div>

                <div className="border border-[#E2E8F0] p-5 rounded-2xl space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[#94A3B8]">Ledger & Outstanding Credit</h3>
                  <div className="space-y-2.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-[#64748B]">Outstanding Dues</span>
                      <strong className="text-red-500 font-extrabold">{money(profile?.pending_amount || 0)}</strong>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#64748B]">Assigned Credit Limit</span>
                      <strong className="text-[#1E293B]">{money(profile?.credit_limit || 0)}</strong>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#64748B]">Active Cylinder Deposits</span>
                      <strong className="text-emerald-600 font-bold">{profile?.deposit_cylinders || 0} unit(s)</strong>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* 9. SETTINGS / CHANGE PASSWORD */}
          {activeTab === 'settings' && (
            <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 md:p-8 shadow-sm max-w-lg mx-auto">
              <h2 className="text-2xl font-bold tracking-tight mb-2">Settings</h2>
              <p className="text-sm text-[#64748B] mb-6">Modify login passwords or change preferences.</p>
              
              <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center gap-3 text-xs text-[#64748B] mb-4">
                <AlertTriangle className="text-amber-500 flex-shrink-0" size={16} />
                <span>To adjust connection parameters or request profile changes, please reach out directly to the manager.</span>
              </div>

              <button 
                onClick={() => window.location.href = '/change-password'}
                className="w-full bg-[#2563EB] hover:bg-blue-600 text-white font-bold px-4 py-3 rounded-xl text-xs transition-colors flex items-center justify-center gap-2"
              >
                <Settings size={16} /> Go to Change Password Screen
              </button>
            </div>
          )}

        </main>
      </div>

      {/* ========================================================================= */}
      {/* 3. MODALS AND OVERLAYS */}
      
      {/* A. BOOK Refill CYLINDER DIALOG (WIZARD FLOW) */}
      {isBookingOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="px-6 py-5 border-b border-[#F1F5F9] flex justify-between items-center">
              <div>
                <h3 className="text-lg font-extrabold text-[#1E293B]">Book Cylinder</h3>
                <p className="text-xs text-[#64748B]">Refill request helper wizard</p>
              </div>
              <button 
                onClick={() => { setIsBookingOpen(false); setBookingStep(1); }}
                className="p-1.5 hover:bg-[#F1F5F9] rounded-xl text-[#64748B]"
              >
                <X size={20} />
              </button>
            </div>

            {/* Stepper Wizard Progress bar */}
            {bookingStep < 5 && (
              <div className="px-6 pt-4 flex gap-1">
                {[1, 2, 3, 4].map((step) => (
                  <div 
                    key={step} 
                    className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                      bookingStep >= step ? 'bg-[#F97316]' : 'bg-[#E2E8F0]'
                    }`} 
                  />
                ))}
              </div>
            )}

            {/* Steps views */}
            <div className="p-6">
              
              {/* STEP 1: SELECT CYLINDER */}
              {bookingStep === 1 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-[#334155]">Select Cylinder Size</h4>
                  <div className="space-y-2">
                    {types.map((t) => {
                      const isSelected = selectedCylinder === String(t.id);
                      return (
                        <button
                          type="button"
                          key={t.id}
                          onClick={() => setSelectedCylinder(String(t.id))}
                          className={`w-full text-left p-4 border rounded-2xl flex items-center justify-between transition-all ${
                            isSelected 
                              ? 'border-[#F97316] bg-orange-50/50 shadow-sm' 
                              : 'border-[#E2E8F0] hover:border-slate-350'
                          }`}
                        >
                          <div>
                            <strong className="text-sm text-[#1E293B] block">{t.name}</strong>
                            <span className="text-xs text-[#64748B]">Refill Deposit Weight: {t.weight} KG</span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-extrabold text-orange-600 block">{money(t.selling_price)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <button 
                    onClick={() => setBookingStep(2)}
                    className="w-full bg-[#2563EB] hover:bg-blue-600 text-white font-bold py-3.5 rounded-2xl text-xs transition-colors mt-4 flex items-center justify-center gap-1.5"
                  >
                    Next Step <ChevronRight size={16} />
                  </button>
                </div>
              )}

              {/* STEP 2: QUANTITY & DELIVERY ADDRESS */}
              {bookingStep === 2 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-[#334155]">Cylinder Quantity & Address</h4>
                  
                  <div className="space-y-4">
                    <label className="block">
                      <span className="text-xs font-bold text-[#475569] uppercase block mb-1.5">Quantity (Units)</span>
                      <div className="flex items-center gap-3">
                        <button 
                          type="button"
                          onClick={() => setQuantity(Math.max(1, quantity - 1))}
                          className="w-10 h-10 border border-[#E2E8F0] hover:bg-slate-50 text-[#1E293B] font-extrabold rounded-lg flex items-center justify-center text-lg"
                        >
                          -
                        </button>
                        <span className="w-12 text-center font-bold text-[#1E293B] text-lg">{quantity}</span>
                        <button 
                          type="button"
                          onClick={() => setQuantity(quantity + 1)}
                          className="w-10 h-10 border border-[#E2E8F0] hover:bg-slate-50 text-[#1E293B] font-extrabold rounded-lg flex items-center justify-center text-lg"
                        >
                          +
                        </button>
                      </div>
                    </label>

                    <label className="block">
                      <span className="text-xs font-bold text-[#475569] uppercase block mb-1.5">Delivery Address Area</span>
                      <input 
                        value={address} 
                        onChange={(e) => setAddress(e.target.value)} 
                        className="w-full px-4 py-3 border border-[#E2E8F0] focus:border-[#F97316] rounded-xl text-sm focus:outline-none"
                      />
                    </label>
                  </div>

                  <div className="flex gap-2.5 mt-6">
                    <button 
                      onClick={() => setBookingStep(1)}
                      className="flex-1 bg-slate-50 hover:bg-[#F1F5F9] text-[#64748B] font-bold py-3.5 rounded-2xl text-xs transition-colors"
                    >
                      Back
                    </button>
                    <button 
                      onClick={() => setBookingStep(3)}
                      className="flex-1 bg-[#2563EB] hover:bg-blue-600 text-white font-bold py-3.5 rounded-2xl text-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      Next Step <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: DELIVERY NOTE */}
              {bookingStep === 3 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-[#334155]">Delivery Instructions (Optional)</h4>
                  
                  <label className="block">
                    <span className="text-xs font-bold text-[#475569] uppercase block mb-1.5">Note for dispatch rider</span>
                    <textarea 
                      value={note} 
                      onChange={(e) => setNote(e.target.value)} 
                      placeholder="e.g. Ring doorbell, deliver behind back gates, etc."
                      className="w-full px-4 py-3 border border-[#E2E8F0] focus:border-[#F97316] rounded-xl text-sm focus:outline-none min-h-[100px]"
                    />
                  </label>

                  <div className="flex gap-2.5 mt-6">
                    <button 
                      onClick={() => setBookingStep(2)}
                      className="flex-1 bg-slate-50 hover:bg-[#F1F5F9] text-[#64748B] font-bold py-3.5 rounded-2xl text-xs transition-colors"
                    >
                      Back
                    </button>
                    <button 
                      onClick={() => setBookingStep(4)}
                      className="flex-1 bg-[#2563EB] hover:bg-blue-600 text-white font-bold py-3.5 rounded-2xl text-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      Review Order <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 4: REVIEW & PAYMENT */}
              {bookingStep === 4 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-[#334155] mb-2">Review & Select Payment Mode</h4>
                  
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-2.5 text-xs text-[#475569]">
                    <div className="flex justify-between">
                      <span>Cylinder Type</span>
                      <strong className="text-black">{activeCylinderObj?.name}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Quantity</span>
                      <strong className="text-black">{quantity} unit(s)</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Refill Address</span>
                      <strong className="text-black text-right max-w-[200px] truncate">{address}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Direct Special Price</span>
                      <strong className="text-black">{money(pricingContext.special)}</strong>
                    </div>
                    <div className="pt-2 border-t border-[#E2E8F0] flex justify-between text-sm text-black font-extrabold">
                      <span>Total Invoice</span>
                      <span className="text-[#2563EB]">{money(pricingContext.special * quantity)}</span>
                    </div>
                  </div>

                  {/* Payment option cards */}
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {[
                      { id: 'cash', label: 'Cash on Delivery', desc: 'Pay on arrival' },
                      { id: 'gpay', label: 'UPI / GPay', desc: 'Scan code on arrival' },
                    ].map((pm) => (
                      <button
                        type="button"
                        key={pm.id}
                        onClick={() => setPaymentMode(pm.id as any)}
                        className={`p-3 border text-left rounded-xl transition-all ${
                          paymentMode === pm.id 
                            ? 'border-[#2563EB] bg-[#EFF6FF]' 
                            : 'border-[#E2E8F0] hover:border-slate-350'
                        }`}
                      >
                        <strong className="text-xs text-[#1E293B] block">{pm.label}</strong>
                        <span className="text-[10px] text-[#64748B] mt-0.5">{pm.desc}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-2.5 mt-6">
                    <button 
                      onClick={() => setBookingStep(3)}
                      className="flex-1 bg-slate-50 hover:bg-[#F1F5F9] text-[#64748B] font-bold py-3.5 rounded-2xl text-xs transition-colors"
                      disabled={isBookingSubmitting}
                    >
                      Back
                    </button>
                    <button 
                      onClick={() => handleBookRefill()}
                      className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold py-3.5 rounded-2xl text-xs transition-colors flex items-center justify-center gap-1.5"
                      disabled={isBookingSubmitting}
                    >
                      {isBookingSubmitting ? 'Sending...' : 'Confirm & Request Refill'}
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 5: SUCCESS STATE ANIMATION */}
              {bookingStep === 5 && (
                <div className="text-center py-6 space-y-4">
                  <div className="w-16 h-16 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-md">
                    <CheckCircle2 size={36} className="animate-bounce" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-[#1E293B]">Refill Request Filed!</h4>
                    <p className="text-xs text-[#64748B] mt-1 max-w-xs mx-auto">Your cylinder booking is received. You can track status in the active journey planner.</p>
                  </div>
                  <button 
                    onClick={() => { setIsBookingOpen(false); setBookingStep(1); setActiveTab('track'); }}
                    className="bg-[#2563EB] hover:bg-blue-600 text-white font-bold px-6 py-2.5 rounded-xl text-xs transition-colors"
                  >
                    Go to Track Order
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* B. MECHANIC Visit booking DIALOG */}
      {isMechanicOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleMechanicSubmit} className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="px-6 py-5 border-b border-[#F1F5F9] flex justify-between items-center">
              <div>
                <h3 className="text-lg font-extrabold text-[#1E293B] flex items-center gap-2">
                  <Wrench size={20} className="text-orange-500" /> Book Visit by LPG Mechanic
                </h3>
                <p className="text-xs text-[#64748B]">For safe repair & regulator inspections</p>
              </div>
              <button 
                type="button"
                onClick={() => setIsMechanicOpen(false)}
                className="p-1.5 hover:bg-[#F1F5F9] rounded-xl text-[#64748B]"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              
              {mechanicSuccess ? (
                <div className="text-center py-6 space-y-3">
                  <CheckCircle2 size={40} className="mx-auto text-emerald-500 animate-pulse" />
                  <h4 className="font-bold text-[#1E293B]">Mechanic Visit Requested!</h4>
                  <p className="text-xs text-[#64748B]">Distributor staff will contact you to coordinate arrival timings.</p>
                </div>
              ) : (
                <>
                  <label className="block">
                    <span className="text-xs font-bold text-[#475569] uppercase block mb-1.5">Select Primary Issue</span>
                    <select 
                      value={mechanicIssue} 
                      onChange={(e) => setMechanicIssue(e.target.value)} 
                      className="w-full px-4 py-3 border border-[#E2E8F0] rounded-xl text-sm focus:outline-none"
                    >
                      <option value="gas_leak">Gas Leak / Hose Leak</option>
                      <option value="low_flame">Low Burner Flame</option>
                      <option value="pipe_issue">Cylinder Pipe / Hose replacement</option>
                      <option value="regulator">Regulator malfunctioning</option>
                      <option value="others">Other general checkup</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-bold text-[#475569] uppercase block mb-1.5">Preferred Date / Time slot</span>
                    <input 
                      type="datetime-local" 
                      value={mechanicTime} 
                      onChange={(e) => setMechanicTime(e.target.value)} 
                      className="w-full px-4 py-3 border border-[#E2E8F0] rounded-xl text-sm focus:outline-none"
                      required
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs font-bold text-[#475569] uppercase block mb-1.5">Additional notes/symptoms</span>
                    <textarea 
                      value={mechanicNote} 
                      onChange={(e) => setMechanicNote(e.target.value)} 
                      placeholder="Explain details of burner behavior..."
                      className="w-full px-4 py-3 border border-[#E2E8F0] rounded-xl text-sm focus:outline-none min-h-[80px]"
                    />
                  </label>

                  <button 
                    type="submit" 
                    className="w-full bg-[#2563EB] hover:bg-blue-600 text-white font-bold py-3.5 rounded-2xl text-xs transition-colors mt-2"
                  >
                    Confirm Visit Request
                  </button>
                </>
              )}

            </div>
          </form>
        </div>
      )}

      {/* C. EMERGENCY SAFETY INFO DIALOG */}
      {isEmergencyOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="px-6 py-5 border-b border-[#F1F5F9] bg-red-600 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <ShieldAlert size={22} className="animate-bounce" />
                <div>
                  <h3 className="text-base font-extrabold">Emergency Gas Leak Contacts</h3>
                  <p className="text-[10px] text-red-100">National LPG Safety helpline</p>
                </div>
              </div>
              <button 
                onClick={() => setIsEmergencyOpen(false)}
                className="p-1.5 hover:bg-red-700/50 rounded-xl text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              
              <div className="bg-red-50 border border-red-100 p-4 rounded-xl space-y-2">
                <span className="text-xs font-bold text-red-800 uppercase block tracking-wider">Gas Leak Helpline Call</span>
                <a 
                  href="tel:1906" 
                  className="text-2xl font-black text-red-600 flex items-center gap-2 hover:underline"
                >
                  📞 1906 (Toll-Free)
                </a>
                <p className="text-xs text-red-800/80">Dial immediately if you notice heavy gas smell or cylinder leakage.</p>
              </div>

              <div className="space-y-2.5">
                <h4 className="text-xs font-bold text-[#334155] uppercase tracking-wide">Safety Instructions</h4>
                {[
                  'Do NOT switch ON or OFF any electrical appliances.',
                  'Do NOT light matches, candles, or use lighter sparks.',
                  'Open all doors and windows immediately for ventilation.',
                  'Turn off the regulator valve on top of the cylinder immediately.'
                ].map((ins, idx) => (
                  <div key={idx} className="flex gap-2 text-xs text-[#475569]">
                    <span className="text-red-500 font-bold">•</span>
                    <span>{ins}</span>
                  </div>
                ))}
              </div>

              <button 
                onClick={() => setIsEmergencyOpen(false)}
                className="w-full bg-[#1E293B] hover:bg-black text-white font-bold py-3 rounded-xl text-xs transition-colors"
              >
                Understood, Close Info
              </button>

            </div>
          </div>
        </div>
      )}

      {/* D. MOBILE NAVIGATION DRAWER */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 lg:hidden">
          <div className="bg-white w-64 h-full p-6 flex flex-col relative animate-in slide-in-from-left duration-200">
            <button 
              onClick={() => setIsMobileMenuOpen(false)}
              className="absolute top-4 right-4 p-2 hover:bg-[#F1F5F9] rounded-lg text-[#64748B]"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-2 mb-8 mt-2">
              <div className="bg-[#F97316] text-white p-2 rounded-xl shadow-md">
                <Flame size={20} />
              </div>
              <span className="text-lg font-extrabold tracking-tight">GasBook</span>
            </div>

            <nav className="flex-1 space-y-1">
              {[
                { id: 'home', label: 'Home', icon: Home },
                { id: 'connections', label: 'My Connections', icon: Compass },
                { id: 'book', label: 'Book Cylinder', icon: PackagePlus, action: () => { setIsMobileMenuOpen(false); setIsBookingOpen(true); } },
                { id: 'track', label: 'Track Order', icon: MapPin },
                { id: 'history', label: 'Booking History', icon: History },
                { id: 'offers', label: 'Offers & Rewards', icon: Gift },
                { id: 'help', label: 'Help & Support', icon: HelpCircle },
                { id: 'profile', label: 'Profile', icon: User },
                { id: 'settings', label: 'Settings', icon: Settings },
              ].map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.action) {
                        item.action();
                      } else {
                        setActiveTab(item.id as any);
                        setIsMobileMenuOpen(false);
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                      isActive 
                        ? 'bg-[#EFF6FF] text-[#2563EB]' 
                        : 'text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#1E293B]'
                    }`}
                  >
                    <Icon size={18} className={isActive ? 'text-[#2563EB]' : 'text-[#64748B]'} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <hr className="border-[#F1F5F9] my-4" />

            <button 
              onClick={() => { logout(); window.location.href = '/login'; }}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-red-50 flex items-center gap-2 text-red-650 font-bold rounded-xl"
            >
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>
      )}

      {/* E. MOBILE BOTTOM NAVIGATION */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#E2E8F0] py-2.5 px-4 flex justify-around items-center lg:hidden z-25">
        {[
          { id: 'home', label: 'Home', icon: Home },
          { id: 'track', label: 'Track', icon: MapPin },
          { id: 'book_quick', label: 'Book', icon: PackagePlus, action: () => setIsBookingOpen(true) },
          { id: 'history', label: 'History', icon: History },
          { id: 'profile', label: 'Profile', icon: User },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === (item.id as any) && item.id !== 'book_quick';
          return (
            <button
              key={item.id}
              onClick={() => {
                if (item.action) {
                  item.action();
                } else {
                  setActiveTab(item.id as any);
                }
              }}
              className={`flex flex-col items-center gap-1 text-[10px] font-bold ${
                isActive ? 'text-[#2563EB]' : 'text-[#64748B]'
              }`}
            >
              <Icon size={18} className={isActive ? 'text-[#2563EB]' : 'text-[#64748B]'} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

    </div>
  );
}
