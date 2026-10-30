const Footer = () => {
  const footerLinks = {
    'Watching': [
      { label: 'Movies', href: '#movies' },
      { label: 'Series', href: '#series' },
      { label: 'IPTV', href: '#iptv' },
    ],
    'Browse': [
      { label: 'Videos', href: 'videos.html' },
      { label: 'Podcast', href: 'podcast.html' },
      { label: 'Pictures', href: 'picture.html' },
      { label: 'Documents', href: 'document.html' },
      { label: 'Articles', href: 'articls.html' },
      { label: 'Answers', href: 'answer.html' },
      { label: 'Reviews', href: 'review.html' },
    ],
    'Earn': [
      { label: 'Store', href: 'market.html' },
      { label: 'Auction', href: 'auction.html' },
      { label: 'Bank', href: 'bank.html' },
      { label: 'Prizes', href: 'prize.html' },
      { label: 'Tasks', href: 'task.html' },
    ],
    'Pages': [
      { label: 'About', href: 'about.html' },
      { label: 'Privacy', href: 'previcy.html' },
      { label: 'Terms', href: 'terms.html' },
      { label: 'Contact', href: 'contact.html' },
      { label: 'Help', href: 'help.html' },
    ],
  };

  const socialLinks = [
    { name: 'YouTube', url: 'https://www.youtube.com/@CineauraV2', icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
    )},
    { name: 'Facebook', url: 'https://www.facebook.com/CineauraV2', icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
    )},
    { name: 'Instagram', url: 'https://www.instagram.com/cineaurav2/', icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>
    )},
    { name: 'TikTok', url: 'https://www.tiktok.com/@cineauraV2', icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>
    )},
    { name: 'Telegram', url: 'https://t.me/CineauraV2', icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-1.013.527-1.49.491-.534-.04-1.553-.343-2.29-1.056-.271-.262-.519-.642-.596-.962-.089-.368.023-.642.259-.864.439-.414 1.063-.666 1.674-.918.66-.273 3.493-1.476 3.493-1.476s-.034-.044-.098-.112c-.064-.068-.184-.168-.184-.168l.001-.001-.002-.003c-.048-.042-.096-.078-.136-.11a.332.332 0 0 0-.096-.058c-.012-.005-.02-.01-.033-.014-.065-.027-.134-.038-.2-.034-.142.008-3.414.617-3.414.617l.001-.001z"/></svg>
    )},
    { name: 'Reddit', url: 'https://www.reddit.com/r/Cineaura2', icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.597a.327.327 0 0 1 .463.018c.655.655 1.707.983 2.753.983 1.046 0 2.098-.328 2.753-.983a.327.327 0 0 1 .463.463c-.788.788-2.026 1.177-3.216 1.177-1.19 0-2.428-.389-3.216-1.177a.327.327 0 0 1 .018-.463z"/></svg>
    )},
  ];

  return (
    <footer className="bg-[#1c1e21] text-white">
      {/* Main Footer */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <img src="https://image.qwenlm.ai/generated-images/ee55a371-b71e-408f-be53-d3b8c4b60357/_result.png" alt="1World" className="w-10 h-10 rounded-full object-cover" />
              <span className="text-[#1877f2] font-bold text-xl">1World</span>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Your ultimate destination for movies, series, and IPTV channels. Join our community today!
            </p>
            {/* Social Links */}
            <div className="flex gap-3 flex-wrap">
              {socialLinks.map(s => (
                <a
                  key={s.name}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 bg-[#3a3b3c] hover:bg-[#1877f2] rounded-full flex items-center justify-center transition-colors"
                  title={s.name}
                >
                  {s.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Link Sections */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 className="font-bold text-sm mb-4 text-[#e4e6eb]">{title}</h3>
              <ul className="space-y-2">
                {links.map(link => (
                  <li key={link.label}>
                    <a href={link.href} className="text-sm text-gray-400 hover:text-[#1877f2] transition-colors">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Footer */}
      <div className="border-t border-[#3a3b3c]">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-400">
            © 2024 1World. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <a href="previcy.html" className="hover:text-[#1877f2] transition-colors">Privacy</a>
            <a href="terms.html" className="hover:text-[#1877f2] transition-colors">Terms</a>
            <a href="contact.html" className="hover:text-[#1877f2] transition-colors">Contact</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
