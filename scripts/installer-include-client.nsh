; ============================================================================
; installer-include-client.nsh
;
; NSIS macro hooks for the Contractor Plus CLIENT installer.
;
; The CLIENT build is a thin shell over the renderer: it does NOT ship the
; backend tree (resources/backend is absent) and does NOT install or manage the
; ContractorPlusBackend Windows Service. Keeping these hooks as no-ops prevents
; the client installer from touching Windows Services on machines that have no
; backing backend files.
;
; NOTE: runtime client mode (pointing the app at a remote server) additionally
; requires a server-URL setting in the frontend, which is out of scope for the
; packaging work. This config + hook exist for structural parity with nuqta.
; ============================================================================

!macro customInstall
  DetailPrint "[ContractorPlus Client] no backend service to install (thin client)"
!macroend

!macro customUnInstall
  DetailPrint "[ContractorPlus Client] no backend service to remove (thin client)"
!macroend
