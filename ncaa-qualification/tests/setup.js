import { configure } from '@testing-library/react'

// CI runners are several times slower than a laptop, and the first App render
// in a file can take over a second there; the 1s default made findBy* flaky.
configure({ asyncUtilTimeout: 5000 })
