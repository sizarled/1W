import { useApp } from '../App';

const Sidebar = () => {
  const { sidebarOpen, setSidebarOpen } = useApp();

  const sections = [
    {
      title: 'Watching',
      items: [
        { label: 'Movies', href: '#movies', icon: '🎬' },
        { label: 'Series', href: '#series', icon: '📺' },
        { label: 'IPTV', href: '#iptv', icon: '📡' },
      ]
    },
    {
      title: 'Browse',
      items: [
        { label: 'Videos', href: 'videos.html', icon: '🎥' },
        { label: 'Podcast', href: 'podcast.html', icon: '🎙️' },
        { label: 'Pictures', href: 'picture.html', icon: '🖼️' },
        { label: 'Documents', href: 'document.html', icon: '📄' },
        { label: 'Articles', href: 'articls.html', icon: '📝' },
        { label: 'Answers', href: 'answer.html', icon: '💬' },
        { label: 'Reviews', href: 'review.html', icon: '⭐' },
      ]
    },
    {
      title: 'Earn',
      items: [
        { label: 'Store', href: 'market.html', icon: '🛒' },
        { label: 'Auction', href: 'auction.html', icon: '🔨' },
        { label: 'Bank', href: 'bank.html', icon: '🏦' },
        { label: 'Prizes', href: 'prize.html', icon: '🏆' },
        { label: 'Tasks', href: 'task.html', icon: '✅' },
      ]
    },
    {
      title: 'Pages',
      items: [
        { label: 'About', href: 'about.html', icon: 'ℹ️' },
        { label: 'Privacy', href: 'previcy.html', icon: '🔒' },
        { label: 'Terms', href: 'terms.html', icon: '📋' },
        { label: 'Contact', href: 'contact.html', icon: '📧' },
        { label: 'Help', href: 'help.html', icon: '❓' },
      ]
    }
  ];

  if (!sidebarOpen) return null;

  return (
    <>
    {/* Mobile overlay */}
    <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)}></div>
    <aside className="fixed left-0 top-[56px] bottom-0 w-[280px] bg-white border-r border-[#ced0d4] overflow-y-auto z-40 animate-slideIn shadow-xl">
      <div className="p-3">
        {/* Profile Link */}
        <a href="profile.html" className="sidebar-link flex items-center gap-3 p-2 mb-2">
          <div className="w-9 h-9 bg-[#1877f2] rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <span className="font-medium text-sm">My Profile</span>
        </a>

        <hr className="border-[#ced0d4] my-2" />

        {/* Navigation Sections */}
        {sections.map((section) => (
          <div key={section.title} className="mb-3">
            <h3 className="px-2 py-1 text-xs font-bold text-[#65676b] uppercase tracking-wider">
              {section.title}
            </h3>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="sidebar-link flex items-center gap-3 p-2 rounded-lg"
                >
                  <span className="text-lg">{item.icon}</span>
                  <span className="text-sm font-medium text-[#050505]">{item.label}</span>
                </a>
              ))}
            </div>
          </div>
        ))}

        {/* Additional Links */}
        <hr className="border-[#ced0d4] my-2" />
        <div className="space-y-0.5">
          <a href="search.html" className="sidebar-link flex items-center gap-3 p-2 rounded-lg">
            <svg className="w-5 h-5 text-[#65676b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-sm font-medium">Search</span>
          </a>
          <a href="dashboard.html" className="sidebar-link flex items-center gap-3 p-2 rounded-lg">
            <svg className="w-5 h-5 text-[#65676b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            <span className="text-sm font-medium">Dashboard</span>
          </a>
        </div>
      </div>
    </aside>
    </>
  );
};

export default Sidebar;
