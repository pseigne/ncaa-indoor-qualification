

export default function Footer() {
    return <footer className="app-footer-credit">
        <p>
            Data sourced automatically from the TFRRS.org Qualifying Lists. &bull; Developed by{' '}
            <a
                href="https://pseigne.github.io/website"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: '600' }}
            >
                Pierce Seigne
            </a>
        </p>
    </footer>

}