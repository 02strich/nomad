package api

import (
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const (
	// OriginStart and OriginEnd are the available parameters for the origin
	// argument when streaming a file. They respectively offset from the start
	// and end of a file.
	OriginStart = "start"
	OriginEnd   = "end"
)

// AllocFileInfo holds information about a file inside the AllocDir
type AllocFileInfo struct {
	Name     string
	IsDir    bool
	Size     int64
	FileMode string
	ModTime  time.Time
}

// StreamFrame is used to frame data of a file when streaming
type StreamFrame struct {
	Offset    int64
	Data      string
	File      string
	FileEvent string
}

func (s *StreamFrame) IsHeartbeat() bool {
	return s.Data == "" && s.FileEvent == ""
}

// AllocFS is used to introspect an allocation directory on a Nomad client
type AllocFS struct {
	client *Client
}

// AllocFS returns an handle to the AllocFS endpoints
func (c *Client) AllocFS() *AllocFS {
	return &AllocFS{client: c}
}

// List is used to list the files at a given path of an allocation directory
func (a *AllocFS) List(alloc *Allocation, path string, q *QueryOptions) ([]*AllocFileInfo, *QueryMeta, error) {
	node, _, err := a.client.Nodes().Info(alloc.NodeID, &QueryOptions{})
	if err != nil {
		return nil, nil, err
	}

	if node.HTTPAddr == "" {
		return nil, nil, fmt.Errorf("http addr of the node where alloc %q is running is not advertised", alloc.ID)
	}
	u := &url.URL{
		Scheme: "http",
		Host:   node.HTTPAddr,
		Path:   fmt.Sprintf("/v1/client/fs/ls/%s", alloc.ID),
	}
	v := url.Values{}
	v.Set("path", path)
	u.RawQuery = v.Encode()
	req := &http.Request{
		Method: "GET",
		URL:    u,
	}
	c := http.Client{}
	resp, err := c.Do(req)
	if err != nil {
		return nil, nil, err
	}
	if resp.StatusCode != 200 {
		return nil, nil, a.getErrorMsg(resp)
	}
	decoder := json.NewDecoder(resp.Body)
	var files []*AllocFileInfo
	if err := decoder.Decode(&files); err != nil {
		return nil, nil, err
	}
	return files, nil, nil
}

// Stat is used to stat a file at a given path of an allocation directory
func (a *AllocFS) Stat(alloc *Allocation, path string, q *QueryOptions) (*AllocFileInfo, *QueryMeta, error) {
	node, _, err := a.client.Nodes().Info(alloc.NodeID, &QueryOptions{})
	if err != nil {
		return nil, nil, err
	}

	if node.HTTPAddr == "" {
		return nil, nil, fmt.Errorf("http addr of the node where alloc %q is running is not advertised", alloc.ID)
	}
	u := &url.URL{
		Scheme: "http",
		Host:   node.HTTPAddr,
		Path:   fmt.Sprintf("/v1/client/fs/stat/%s", alloc.ID),
	}
	v := url.Values{}
	v.Set("path", path)
	u.RawQuery = v.Encode()
	req := &http.Request{
		Method: "GET",
		URL:    u,
	}
	c := http.Client{}
	resp, err := c.Do(req)
	if err != nil {
		return nil, nil, err
	}
	if resp.StatusCode != 200 {
		return nil, nil, a.getErrorMsg(resp)
	}
	decoder := json.NewDecoder(resp.Body)
	var file *AllocFileInfo
	if err := decoder.Decode(&file); err != nil {
		return nil, nil, err
	}
	return file, nil, nil
}

// ReadAt is used to read bytes at a given offset until limit at the given path
// in an allocation directory
func (a *AllocFS) ReadAt(alloc *Allocation, path string, offset int64, limit int64, q *QueryOptions) (io.Reader, *QueryMeta, error) {
	node, _, err := a.client.Nodes().Info(alloc.NodeID, &QueryOptions{})
	if err != nil {
		return nil, nil, err
	}

	if node.HTTPAddr == "" {
		return nil, nil, fmt.Errorf("http addr of the node where alloc %q is running is not advertised", alloc.ID)
	}
	u := &url.URL{
		Scheme: "http",
		Host:   node.HTTPAddr,
		Path:   fmt.Sprintf("/v1/client/fs/readat/%s", alloc.ID),
	}
	v := url.Values{}
	v.Set("path", path)
	v.Set("offset", strconv.FormatInt(offset, 10))
	v.Set("limit", strconv.FormatInt(limit, 10))
	u.RawQuery = v.Encode()
	req := &http.Request{
		Method: "GET",
		URL:    u,
	}
	c := http.Client{}
	resp, err := c.Do(req)
	if err != nil {
		return nil, nil, err
	}
	return resp.Body, nil, nil
}

// Cat is used to read contents of a file at the given path in an allocation
// directory
func (a *AllocFS) Cat(alloc *Allocation, path string, q *QueryOptions) (io.Reader, *QueryMeta, error) {
	node, _, err := a.client.Nodes().Info(alloc.NodeID, &QueryOptions{})
	if err != nil {
		return nil, nil, err
	}

	if node.HTTPAddr == "" {
		return nil, nil, fmt.Errorf("http addr of the node where alloc %q is running is not advertised", alloc.ID)
	}
	u := &url.URL{
		Scheme: "http",
		Host:   node.HTTPAddr,
		Path:   fmt.Sprintf("/v1/client/fs/cat/%s", alloc.ID),
	}
	v := url.Values{}
	v.Set("path", path)
	u.RawQuery = v.Encode()
	req := &http.Request{
		Method: "GET",
		URL:    u,
	}
	c := http.Client{}
	resp, err := c.Do(req)
	if err != nil {
		return nil, nil, err
	}
	return resp.Body, nil, nil
}

func (a *AllocFS) getErrorMsg(resp *http.Response) error {
	if errMsg, err := ioutil.ReadAll(resp.Body); err == nil {
		return fmt.Errorf(string(errMsg))
	} else {
		return err
	}
}

func (a *AllocFS) Stream(alloc *Allocation, path, origin string, offset int64,
	cancel <-chan struct{}, q *QueryOptions) (<-chan *StreamFrame, *QueryMeta, error) {

	node, _, err := a.client.Nodes().Info(alloc.NodeID, q)
	if err != nil {
		return nil, nil, err
	}

	if node.HTTPAddr == "" {
		return nil, nil, fmt.Errorf("http addr of the node where alloc %q is running is not advertised", alloc.ID)
	}
	u := &url.URL{
		Scheme: "http",
		Host:   node.HTTPAddr,
		Path:   fmt.Sprintf("/v1/client/fs/stream/%s", alloc.ID),
	}
	v := url.Values{}
	v.Set("path", path)
	v.Set("origin", origin)
	v.Set("offset", strconv.FormatInt(offset, 10))
	u.RawQuery = v.Encode()
	req := &http.Request{
		Method: "GET",
		URL:    u,
		Cancel: cancel,
	}
	c := http.Client{}
	resp, err := c.Do(req)
	if err != nil {
		return nil, nil, err
	}

	// Create the output channel
	frames := make(chan *StreamFrame, 10)

	go func() {
		// Close the body
		defer resp.Body.Close()

		// Create a decoder
		dec := json.NewDecoder(resp.Body)

		for {
			// Check if we have been cancelled
			select {
			case <-cancel:
				return
			default:
			}

			// Decode the next frame
			var frame StreamFrame
			if err := dec.Decode(&frame); err != nil {
				close(frames)
				return
			}

			// Discard heartbeat frames
			if frame.IsHeartbeat() {
				continue
			}

			frames <- &frame
		}
	}()

	return frames, nil, nil
}
