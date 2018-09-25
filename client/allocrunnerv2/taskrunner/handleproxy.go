package taskrunner

import (
	"context"

	"github.com/hashicorp/nomad/client/driver/structs"
)

// handleResult multiplexes a single WaitResult to multiple waiters. Useful
// because DriverHandle.WaitCh is closed after it returns a single WaitResult.
type handleResult struct {
	doneCh <-chan struct{}
	result *structs.WaitResult
}

func newHandleResult(waitCh <-chan *structs.WaitResult) *handleResult {
	doneCh := make(chan struct{})

	h := &handleResult{
		doneCh: doneCh,
	}

	go func() {
		// Wait for result
		res := <-waitCh

		// Set result
		h.result = res

		// Notify waiters
		close(doneCh)

	}()

	return h
}

// Wait blocks until a task's result is available or the passed-in context is
// canceled. Safe for concurrent callers.
func (h *handleResult) Wait(ctx context.Context) *structs.WaitResult {
	// Block until done or canceled
	select {
	case <-h.doneCh:
	case <-ctx.Done():
		return nil
	}

	return h.result
}
