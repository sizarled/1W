import { useState, useRef, useEffect } from 'react';
import { useApp, SOUNDS, playSound } from '../App';

const Header = () => {
  const { isLoggedIn, points, level, sidebarOpen, setSidebarOpen, notifications } = useApp();
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifFilter, setNotifFilter] = useState('hour');
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotifClick = () => {
    playSound(SOUNDS.notification);
    setShowNotifications(!showNotifications);
  };

  const navItems = [
    { label: 'Features', href: '#features' },
    { label: 'Search', href: '#search' },
    { label: 'Movies', href: '#movies' },
    { label: 'Series', href: '#series' },
    { label: 'IPTV', href: '#iptv' },
    { label: 'Membership', href: '#membership' },
    { label: 'Apps', href: '#apps' },
    { label: 'Support', href: '#support' },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white shadow-sm h-[56px] flex items-center px-4">
      {/* Left Section - Logo & Sidebar Toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-full hover:bg-[#f2f2f2] transition-colors"
          title="Toggle Sidebar"
        >
          <svg className="w-6 h-6 text-[#1877f2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <a href="/" className="flex items-center gap-2">
          <img src="https://image.qwenlm.ai/generated-images/ee55a371-b71e-408f-be53-d3b8c4b60357/_result.png" alt="1World" className="w-10 h-10 rounded-full object-cover" />
          <span className="text-[#1877f2] font-bold text-xl hidden md:block">1World</span>
        </a>
      </div>

      {/* Center - Navigation */}
      <nav className="hidden lg:flex items-center justify-center flex-1 mx-4">
        <div className="flex items-center gap-1">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="px-3 py-2 text-sm font-medium text-[#65676b] hover:bg-[#f2f2f2] rounded-lg transition-colors whitespace-nowrap"
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      {/* Right Section */}
      <div className="flex items-center gap-2">
        {/* Points Display */}
        <div className="hidden md:flex flex-col items-end mr-2">
          <span className="text-xs font-semibold text-[#1877f2]">Points: {points}</span>
          <span className="text-xs text-[#65676b]">Level: LV{level}</span>
        </div>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={handleNotifClick}
            className="p-2 rounded-full bg-[#e4e6eb] hover:bg-[#d8dadf] transition-colors relative"
          >
            <svg className="w-5 h-5 text-[#050505]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center">3</span>
          </button>

          {/* Notification Dropdown */}
          {showNotifications && (
            <div className="absolute right-0 top-12 w-80 bg-white rounded-lg shadow-xl border border-[#ced0d4] overflow-hidden animate-fadeIn">
              <div className="p-3 border-b border-[#ced0d4]">
                <h3 className="font-bold text-lg">Notifications</h3>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {['hour', 'today', 'yesterday', 'week'].map(filter => (
                    <button
                      key={filter}
                      onClick={() => setNotifFilter(filter)}
                      className={`px-2 py-1 text-xs rounded-full ${notifFilter === filter ? 'bg-[#1877f2] text-white' : 'bg-[#e4e6eb] text-[#050505]'}`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <div className="p-3 hover:bg-[#f2f2f2] cursor-pointer border-b border-[#f0f2f5]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#1877f2] rounded-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium">New movie added to trending!</p>
                      <p className="text-xs text-[#65676b]">2 hours ago</p>
                    </div>
                  </div>
                </div>
                <div className="p-3 hover:bg-[#f2f2f2] cursor-pointer border-b border-[#f0f2f5]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#42b72a] rounded-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium">+50 points earned!</p>
                      <p className="text-xs text-[#65676b]">5 hours ago</p>
                    </div>
                  </div>
                </div>
                <div className="p-3 hover:bg-[#f2f2f2] cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#f5a623] rounded-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium">New IPTV channel available!</p>
                      <p className="text-xs text-[#65676b]">1 day ago</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-2 border-t border-[#ced0d4]">
                <a href="notefecation.html" className="block text-center text-sm text-[#1877f2] font-medium hover:underline py-1">
                  See All Notifications
                </a>
              </div>
            </div>
          )}
        </div>

        {/* User Section */}
        {!isLoggedIn ? (
          <div className="flex items-center gap-2">
            {/* Visitor Avatar */}
            <div className="flex items-center gap-2 mr-2">
              <div className="w-8 h-8 bg-[#e4e6eb] rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-[#65676b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="hidden md:block">
                <p className="text-xs font-medium">Visitor</p>
                <p className="text-[10px] text-[#65676b]">VR-{Math.floor(100000 + Math.random() * 900000)}</p>
              </div>
            </div>
            <a href="login.html" className="px-4 py-2 bg-[#1877f2] text-white text-sm font-medium rounded-lg hover:bg-[#1565c0] transition-colors">
              Login
            </a>
            <a href="register.html" className="px-4 py-2 bg-[#42b72a] text-white text-sm font-medium rounded-lg hover:bg-[#36a420] transition-colors">
              Register
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <a href="profile.html" className="flex items-center gap-2 hover:bg-[#f2f2f2] rounded-lg px-2 py-1 transition-colors">
              <div className="w-8 h-8 bg-[#1877f2] rounded-full flex items-center justify-center overflow-hidden">
                <img src="" alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="hidden md:block">
                <p className="text-xs font-medium">Username</p>
                <p className="text-[10px] text-[#65676b]">ID - {Math.floor(100000 + Math.random() * 900000)}</p>
              </div>
            </a>
            <a href="dashboard.html" className="px-3 py-2 bg-[#e4e6eb] text-[#050505] text-sm font-medium rounded-lg hover:bg-[#d8dadf] transition-colors">
              Dashboard
            </a>
            <button className="px-3 py-2 bg-[#e4e6eb] text-[#050505] text-sm font-medium rounded-lg hover:bg-[#d8dadf] transition-colors">
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
