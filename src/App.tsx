
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import ProtectedRoute from './components/ProtectedRoute'

import Login from './features/auth/Login'
import Signup from './features/auth/Signup'
import ResetPassword from './features/auth/ResetPassword'
import SavedSearches from './features/searches/SavedSearches'
import Onboarding from './features/profile/Onboarding'
import ProfileOverview from './features/profile/ProfileOverview'
import JobSubmission from './features/jobs/JobSubmission'
import JobResults from './features/jobs/JobResults'
import Tracker from './features/tracker/Tracker'
import AppShell from './components/AppShell'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/app/profile" element={<ProfileOverview />} />
            <Route path="/app/jobs/new" element={<JobSubmission />} />
            <Route path="/app/jobs/:id" element={<JobResults />} />
            <Route path="/app/tracker" element={<Tracker />} />
            <Route path="/app/searches" element={<SavedSearches />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
