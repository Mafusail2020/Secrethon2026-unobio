export function FooterMarkup() {
  return (
    <footer className="text-white" style={{ backgroundColor: "rgb(4, 8, 26)" }}>
      <div className="max-w-content mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
          <div className="md:col-span-4">
            <div className="mb-6">
              <div className="flex items-center gap-3">
                <img alt="Unobio Logo" width="36" height="36" className="h-9 w-9 object-contain" src="/unobio/images/logo_ui.png" />
                <span className="text-lg font-medium font-switzer tracking-subheading text-white">
                  Unobio
                </span>
              </div>
            </div>
            <p className="text-sm text-mist leading-relaxed mb-4">
              Unobio, Inc.
              <br />
              400 NW 26th St
              <br />
              Miami, FL 33127
            </p>
            <a className="text-sm text-mist hover:text-white transition-colors duration-150">
              hello@unobio.com
            </a>
          </div>
          <div className="md:col-span-4">
            <h4 className="font-medium text-white mb-4 text-sm">
              Company
            </h4>
            <ul className="space-y-3">
              <li>
                <a className="text-mist hover:text-white transition-colors duration-150 text-sm">
                  Diligence
                </a>
              </li>
              <li>
                <a className="text-mist hover:text-white transition-colors duration-150 text-sm">
                  {"Licensing & Pipeline"}
                </a>
              </li>
              <li>
                <a className="text-mist hover:text-white transition-colors duration-150 text-sm">
                  About Us
                </a>
              </li>
              <li>
                <a className="text-mist hover:text-white transition-colors duration-150 text-sm">
                  Blog
                </a>
              </li>
              <li>
                <a className="text-mist hover:text-white transition-colors duration-150 text-sm">
                  Careers
                </a>
              </li>
              <li>
                <a className="text-mist hover:text-white transition-colors duration-150 text-sm">
                  Contact Us
                </a>
              </li>
            </ul>
          </div>
          <div className="md:col-span-4">
            <h4 className="font-medium text-white mb-4 text-sm">
              Legal
            </h4>
            <ul className="space-y-3">
              <li>
                <a className="text-mist hover:text-white transition-colors duration-150 text-sm">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a className="text-mist hover:text-white transition-colors duration-150 text-sm">
                  Terms of Use
                </a>
              </li>
              <li>
                <button className="text-gray-400 hover:text-white transition-colors text-sm text-left">
                  Cookie Settings
                </button>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-mist/20 mt-12 pt-6 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-mist text-sm">
            {"© 2024 – "}
            2026
            {" Unobio, Inc. All rights reserved."}
          </p>
          <a className="text-mist hover:text-white transition-colors duration-150" aria-label="LinkedIn">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
          </a>
        </div>
      </div>
      <div className="w-full overflow-hidden select-none pointer-events-none footer-wordmark-container" aria-hidden="true">
        <p className="text-center font-extrabold uppercase text-white whitespace-nowrap leading-none footer-wordmark-text" style={{ letterSpacing: "-0.04em" }}>
          Unobio
        </p>
      </div>
    </footer>
  );
}
