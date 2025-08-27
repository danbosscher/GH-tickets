import React, { useState, useEffect } from 'react';

interface RoadmapItem {
  id: string;
  title: string;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  lastEditedAt: string | null;
  status: string;
  labels: Array<{
    name: string;
    color: string;
  }>;
  assignees: Array<{
    login: string;
    name: string | null;
    avatarUrl: string;
  }>;
  extractedDate: string | null;
  extractedEta?: {
    date: string;
    author: string;
    commentText: string;
    url: string;
  } | null;
  lastComment?: {
    createdAt: string;
    author: {
      login: string;
      name: string | null;
    };
  } | null;
  needsResponse?: boolean;
}

const RoadmapPage: React.FC = () => {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [selectedAssignees, setSelectedAssignees] = useState<Set<string>>(new Set());
  const [selectedNeedsResponse, setSelectedNeedsResponse] = useState<boolean>(false);
  const [selectedUnassigned, setSelectedUnassigned] = useState<boolean>(false);
  const [labelsDropdownOpen, setLabelsDropdownOpen] = useState(false);
  const [assigneesDropdownOpen, setAssigneesDropdownOpen] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [needsResponseDropdownOpen, setNeedsResponseDropdownOpen] = useState(false);
  const [unassignedDropdownOpen, setUnassignedDropdownOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(['title', 'labels', 'assignees', 'created', 'updated', 'timeline', 'lastComment', 'needsResponse']));
  const [columnsDropdownOpen, setColumnsDropdownOpen] = useState(false);
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<{step: string, current: number, total: number} | null>(null);
  const [copyLinkSuccess, setCopyLinkSuccess] = useState(false);

  const isDataRecent = () => {
    if (!lastUpdated) return false;
    const updated = new Date(lastUpdated);
    const now = new Date();
    const diffMinutes = (now.getTime() - updated.getTime()) / (1000 * 60);
    return diffMinutes < 1;
  };

  useEffect(() => {
    fetchRoadmapData();
    fetchCacheInfo();
  }, []);

  useEffect(() => {
    if (items.length > 0) {
      // Check if URL has filter parameters
      const urlParams = new URLSearchParams(window.location.search);
      const hasUrlFilters = urlParams.toString().length > 0;
      
      // Get all unique values for comparison
      const uniqueStatuses = [...new Set(items.map(item => item.status))];
      const uniqueLabels = [...new Set(items.flatMap(item => item.labels.map(label => label.name)))];
      const uniqueAssignees = [...new Set(items.flatMap(item => item.assignees.map(assignee => assignee.name || assignee.login)))];
      
      if (hasUrlFilters) {
        // Load filters from URL
        if (urlParams.has('statuses')) {
          const statuses = urlParams.get('statuses')?.split(',').filter(s => s) || [];
          setSelectedStatuses(new Set(statuses));
        } else {
          // No statuses param means all are selected
          setSelectedStatuses(new Set(uniqueStatuses));
        }
        
        if (urlParams.has('labels')) {
          const labels = urlParams.get('labels')?.split(',').filter(l => l) || [];
          setSelectedLabels(new Set(labels));
        } else {
          // No labels param means all are selected
          setSelectedLabels(new Set(uniqueLabels));
        }
        
        if (urlParams.has('assignees')) {
          const assignees = urlParams.get('assignees')?.split(',').filter(a => a) || [];
          setSelectedAssignees(new Set(assignees));
        } else {
          // No assignees param means all are selected
          setSelectedAssignees(new Set(uniqueAssignees));
        }
        
        if (urlParams.has('needsResponse')) {
          setSelectedNeedsResponse(urlParams.get('needsResponse') === 'true');
        }
        
        if (urlParams.has('unassigned')) {
          setSelectedUnassigned(urlParams.get('unassigned') === 'true');
        }
        
        if (urlParams.has('columns')) {
          const columns = urlParams.get('columns')?.split(',').filter(c => c) || [];
          setVisibleColumns(new Set(columns));
        }
      } else {
        // Load from localStorage if no URL parameters
        const savedStatuses = localStorage.getItem('selectedStatuses');
        const savedLabels = localStorage.getItem('selectedLabels');
        const savedAssignees = localStorage.getItem('selectedAssignees');
        const savedNeedsResponse = localStorage.getItem('selectedNeedsResponse');
        const savedUnassigned = localStorage.getItem('selectedUnassigned');
        const savedVisibleColumns = localStorage.getItem('visibleColumns');
        
        if (savedStatuses) {
          setSelectedStatuses(new Set(JSON.parse(savedStatuses)));
        } else {
          // Set default selected statuses (exclude Archive, Backlog, and GA)
          const defaultStatuses = uniqueStatuses.filter(status => 
            !status.toLowerCase().includes('archive') && 
            !status.toLowerCase().includes('backlog') &&
            !status.toLowerCase().includes('ga') &&
            !status.toLowerCase().includes('generally available')
          );
          setSelectedStatuses(new Set(defaultStatuses));
        }
        
        if (savedLabels) {
          setSelectedLabels(new Set(JSON.parse(savedLabels)));
        } else {
          setSelectedLabels(new Set(uniqueLabels));
        }
        
        if (savedAssignees) {
          setSelectedAssignees(new Set(JSON.parse(savedAssignees)));
        } else {
          setSelectedAssignees(new Set(uniqueAssignees));
        }
        
        if (savedNeedsResponse) {
          setSelectedNeedsResponse(JSON.parse(savedNeedsResponse));
        }
        
        if (savedUnassigned) {
          setSelectedUnassigned(JSON.parse(savedUnassigned));
        }
        
        if (savedVisibleColumns) {
          setVisibleColumns(new Set(JSON.parse(savedVisibleColumns)));
        }
      }
    }
  }, [items]);

  const fetchRoadmapData = async (forceRefresh = false) => {
    let cleanup: (() => void) | null = null;
    
    try {
      setLoading(true);
      if (forceRefresh) {
        setRefreshing(true);
      }
      
      // Set up Server-Sent Events for progress updates for both initial load and refresh
      const eventSource = new EventSource('/api/progress?type=roadmap');
      eventSource.onmessage = (event) => {
        try {
          const progressData = JSON.parse(event.data);
          setProgress(progressData);
        } catch (e) {
          console.error('Failed to parse progress data:', e);
        }
      };
      
      eventSource.onerror = () => {
        eventSource.close();
      };
      
      // Clean up event source when request completes
      cleanup = () => {
        eventSource.close();
        setProgress(null);
      };
      
      setTimeout(() => cleanup?.(), 30000); // Cleanup after 30 seconds max
      
      const url = forceRefresh ? '/api/roadmap?refresh=true' : '/api/roadmap';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setItems(data);
      
      if (forceRefresh) {
        await fetchCacheInfo();
      }
      
      // Clean up when done
      cleanup?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch roadmap data');
      // Clean up on error too
      cleanup?.();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchCacheInfo = async () => {
    try {
      const response = await fetch('/api/cache-info');
      if (response.ok) {
        const data = await response.json();
        setLastUpdated(data.lastUpdated);
      }
    } catch (err) {
      console.error('Failed to fetch cache info:', err);
    }
  };

  const handleRefresh = () => {
    if (isDataRecent() && !refreshing) {
      if (!confirm('Data was refreshed less than a minute ago. This will take about a minute to complete. Are you sure?')) {
        return;
      }
    }
    fetchRoadmapData(true);
  };

  const filteredItems = items.filter(item => {
    const statusMatch = selectedStatuses.size === 0 || selectedStatuses.has(item.status);
    const labelMatch = selectedLabels.size === 0 || 
      item.labels.length === 0 || 
      item.labels.some(label => selectedLabels.has(label.name));
    const assigneeMatch = selectedAssignees.size === 0 ||
      item.assignees.some(assignee => selectedAssignees.has(assignee.name || assignee.login));
    const unassignedMatch = !selectedUnassigned || item.assignees.length === 0;
    const needsResponseMatch = !selectedNeedsResponse || item.needsResponse;
    return statusMatch && labelMatch && assigneeMatch && unassignedMatch && needsResponseMatch;
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    if (!sortField) return 0;
    
    let aValue: any, bValue: any;
    
    switch (sortField) {
      case 'title':
        aValue = a.title.toLowerCase();
        bValue = b.title.toLowerCase();
        break;
      case 'status':
        aValue = a.status.toLowerCase();
        bValue = b.status.toLowerCase();
        break;
      case 'createdAt':
        aValue = new Date(a.createdAt);
        bValue = new Date(b.createdAt);
        break;
      case 'updatedAt':
        aValue = new Date(a.lastEditedAt || a.updatedAt);
        bValue = new Date(b.lastEditedAt || b.updatedAt);
        break;
      case 'lastComment':
        aValue = a.lastComment ? new Date(a.lastComment.createdAt) : new Date(0);
        bValue = b.lastComment ? new Date(b.lastComment.createdAt) : new Date(0);
        break;
      case 'assignees':
        aValue = a.assignees.length > 0 ? a.assignees[0].name || a.assignees[0].login : '';
        bValue = b.assignees.length > 0 ? b.assignees[0].name || b.assignees[0].login : '';
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
        break;
      default:
        return 0;
    }
    
    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const getStatusBadgeClass = (status: string) => {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('backlog')) return 'status-backlog';
    if (statusLower.includes('planned')) return 'status-planned';
    if (statusLower.includes('development')) return 'status-development';
    if (statusLower.includes('preview')) return 'status-preview';
    if (statusLower.includes('ga')) return 'status-ga';
    if (statusLower.includes('archive')) return 'status-archive';
    return 'status-backlog';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getWaitingTime = (createdAt: string) => {
    const created = new Date(createdAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - created.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 30) return `${diffDays} days`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months`;
    return `${Math.floor(diffDays / 365)} years`;
  };

  const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));
    
    return `refreshed ${diffHours} hours ${diffMinutes} minutes ago`;
  };

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 30) return `${diffDays} days ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  const statusCounts = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Custom status ordering (please provide the desired order)
  const statusOrder = ['Backlog', 'Planned', 'Development', 'Public Preview', 'GA', 'Archive'];
  const uniqueStatuses = [...new Set(items.map(item => item.status))].sort((a, b) => {
    const aIndex = statusOrder.indexOf(a);
    const bIndex = statusOrder.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
  
  // Alphabetical label sorting
  const uniqueLabels = [...new Set(items.flatMap(item => item.labels.map(label => label.name)))].sort();
  
  // Alphabetical assignee sorting
  const uniqueAssignees = [...new Set(items.flatMap(item => item.assignees.map(assignee => assignee.name || assignee.login)))].sort();

  const handleStatusToggle = (status: string) => {
    const newSelected = new Set(selectedStatuses);
    if (newSelected.has(status)) {
      newSelected.delete(status);
    } else {
      newSelected.add(status);
    }
    setSelectedStatuses(newSelected);
    localStorage.setItem('selectedStatuses', JSON.stringify([...newSelected]));
  };

  const handleStatusSelectAll = () => {
    if (selectedStatuses.size === uniqueStatuses.length) {
      setSelectedStatuses(new Set());
      localStorage.setItem('selectedStatuses', JSON.stringify([]));
    } else {
      setSelectedStatuses(new Set(uniqueStatuses));
      localStorage.setItem('selectedStatuses', JSON.stringify(uniqueStatuses));
    }
  };

  const handleLabelToggle = (label: string) => {
    const newSelected = new Set(selectedLabels);
    if (newSelected.has(label)) {
      newSelected.delete(label);
    } else {
      newSelected.add(label);
    }
    setSelectedLabels(newSelected);
    localStorage.setItem('selectedLabels', JSON.stringify([...newSelected]));
  };

  const handleLabelSelectAll = () => {
    if (selectedLabels.size === uniqueLabels.length) {
      setSelectedLabels(new Set());
      localStorage.setItem('selectedLabels', JSON.stringify([]));
    } else {
      setSelectedLabels(new Set(uniqueLabels));
      localStorage.setItem('selectedLabels', JSON.stringify(uniqueLabels));
    }
  };

  const handleAssigneeToggle = (assignee: string) => {
    const newSelected = new Set(selectedAssignees);
    if (newSelected.has(assignee)) {
      newSelected.delete(assignee);
    } else {
      newSelected.add(assignee);
    }
    setSelectedAssignees(newSelected);
    localStorage.setItem('selectedAssignees', JSON.stringify([...newSelected]));
  };

  const handleAssigneeSelectAll = () => {
    if (selectedAssignees.size === uniqueAssignees.length) {
      setSelectedAssignees(new Set());
      localStorage.setItem('selectedAssignees', JSON.stringify([]));
    } else {
      setSelectedAssignees(new Set(uniqueAssignees));
      localStorage.setItem('selectedAssignees', JSON.stringify(uniqueAssignees));
    }
  };

  const handleNeedsResponseToggle = () => {
    const newValue = !selectedNeedsResponse;
    setSelectedNeedsResponse(newValue);
    localStorage.setItem('selectedNeedsResponse', JSON.stringify(newValue));
  };

  const handleUnassignedToggle = () => {
    const newValue = !selectedUnassigned;
    setSelectedUnassigned(newValue);
    localStorage.setItem('selectedUnassigned', JSON.stringify(newValue));
  };

  const handleColumnToggle = (column: string) => {
    const newVisible = new Set(visibleColumns);
    if (newVisible.has(column)) {
      newVisible.delete(column);
    } else {
      newVisible.add(column);
    }
    setVisibleColumns(newVisible);
    localStorage.setItem('visibleColumns', JSON.stringify([...newVisible]));
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: string) => {
    if (sortField !== field) return ' ↕️';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  const copyCurrentFiltersAsUrl = async () => {
    const url = new URL(window.location.href);
    url.search = '';
    
    const params = new URLSearchParams();
    
    // Only include statuses if not all are selected
    if (selectedStatuses.size > 0 && selectedStatuses.size < uniqueStatuses.length) {
      params.set('statuses', Array.from(selectedStatuses).join(','));
    }
    
    // Only include labels if not all are selected
    if (selectedLabels.size > 0 && selectedLabels.size < uniqueLabels.length) {
      params.set('labels', Array.from(selectedLabels).join(','));
    }
    
    // Only include assignees if not all are selected
    if (selectedAssignees.size > 0 && selectedAssignees.size < uniqueAssignees.length) {
      params.set('assignees', Array.from(selectedAssignees).join(','));
    }
    
    // Only include boolean filters if they're true (non-default)
    if (selectedNeedsResponse) {
      params.set('needsResponse', 'true');
    }
    
    if (selectedUnassigned) {
      params.set('unassigned', 'true');
    }
    
    // Only include columns if not the default set
    const defaultColumns = new Set(['title', 'labels', 'assignees', 'created', 'updated', 'timeline', 'lastComment', 'needsResponse']);
    if (visibleColumns.size !== defaultColumns.size || 
        !Array.from(visibleColumns).every(col => defaultColumns.has(col))) {
      params.set('columns', Array.from(visibleColumns).join(','));
    }
    
    url.search = params.toString();
    
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopyLinkSuccess(true);
      setTimeout(() => setCopyLinkSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = url.toString();
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopyLinkSuccess(true);
      setTimeout(() => setCopyLinkSuccess(false), 2000);
    }
  };

  const abbreviateStatus = (status: string) => {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('backlog')) return 'Backlog';
    if (statusLower.includes('planned')) return 'Planned';
    if (statusLower.includes('development')) return 'Dev';
    if (statusLower.includes('preview')) return 'Preview';
    if (statusLower.includes('ga')) return 'GA';
    if (statusLower.includes('archive')) return 'Archive';
    return status.length > 8 ? status.substring(0, 8) + '...' : status;
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          {progress ? (
            <div className="progress-container">
              <div className="progress-text">
                {progress.step}
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                ></div>
              </div>
              <div className="progress-numbers">
                {progress.current} / {progress.total}
              </div>
            </div>
          ) : (
            'Loading Azure AKS roadmap...'
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">
          Error: {error}
          <br />
          <small>Make sure your GitHub token is set in the .env file</small>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <div className="header-content">
          <div className="title-section">
            <h1>Azure AKS Public Roadmap</h1>
            <p>Tracking roadmap items from GitHub project #685</p>
            {lastUpdated && (
              <div className="timestamp">
                {formatTimestamp(lastUpdated)}
              </div>
            )}
          </div>
          <div className="header-buttons">
            <button 
              className="copy-link-button"
              onClick={copyCurrentFiltersAsUrl}
              title="Copy current filters as URL"
            >
              {copyLinkSuccess ? '✓ Copied!' : '🔗 Copy Link'}
            </button>
            <button 
              className={`refresh-button-small ${isDataRecent() ? 'disabled' : ''}`}
              onClick={handleRefresh}
              disabled={refreshing || isDataRecent()}
            >
              {refreshing ? '⟳' : '↻'}
            </button>
          </div>
        </div>
      </div>

      <div className="filters">
        <div className="filters-horizontal">
          <div className="filter-item">
            <h3>Status:</h3>
            <div className="dropdown-filter">
              <button 
                className="dropdown-toggle"
                onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
              >
                Status ({selectedStatuses.size}/{uniqueStatuses.length}) ▼
              </button>
              {statusDropdownOpen && (
                <div className="dropdown-content">
                  <div className="select-all-option">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedStatuses.size === uniqueStatuses.length}
                        onChange={handleStatusSelectAll}
                      />
                      <span>Select All</span>
                    </label>
                  </div>
                  <div className="dropdown-options">
                    {uniqueStatuses.map(status => (
                      <label key={status} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={selectedStatuses.has(status)}
                          onChange={() => handleStatusToggle(status)}
                        />
                        <span className={`status-badge ${getStatusBadgeClass(status)}`}>
                          {status}
                        </span>
                        <span className="count">({statusCounts[status]})</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="filter-item">
            <h3>Labels:</h3>
            <div className="dropdown-filter">
              <button 
                className="dropdown-toggle"
                onClick={() => setLabelsDropdownOpen(!labelsDropdownOpen)}
              >
                Labels ({selectedLabels.size}/{uniqueLabels.length}) ▼
              </button>
              {labelsDropdownOpen && (
                <div className="dropdown-content">
                  <div className="select-all-option">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedLabels.size === uniqueLabels.length}
                        onChange={handleLabelSelectAll}
                      />
                      <span>Select All</span>
                    </label>
                  </div>
                  <div className="dropdown-options">
                    {uniqueLabels.map(label => (
                      <label key={label} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={selectedLabels.has(label)}
                          onChange={() => handleLabelToggle(label)}
                        />
                        <span className="label-badge">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="filter-item">
            <h3>Assignees:</h3>
            <div className="dropdown-filter">
              <button 
                className="dropdown-toggle"
                onClick={() => setAssigneesDropdownOpen(!assigneesDropdownOpen)}
              >
                Assignees ({selectedAssignees.size}/{uniqueAssignees.length}) ▼
              </button>
              {assigneesDropdownOpen && (
                <div className="dropdown-content">
                  <div className="select-all-option">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedAssignees.size === uniqueAssignees.length}
                        onChange={handleAssigneeSelectAll}
                      />
                      <span>Select All</span>
                    </label>
                  </div>
                  <div className="dropdown-options">
                    {uniqueAssignees.map(assignee => (
                      <label key={assignee} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={selectedAssignees.has(assignee)}
                          onChange={() => handleAssigneeToggle(assignee)}
                        />
                        <span>{assignee}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="filter-item">
            <h3>Assignment:</h3>
            <div className="dropdown-filter">
              <button 
                className="dropdown-toggle"
                onClick={() => setUnassignedDropdownOpen(!unassignedDropdownOpen)}
              >
                Assignment ▼
              </button>
              {unassignedDropdownOpen && (
                <div className="dropdown-content">
                  <div className="dropdown-options">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedUnassigned}
                        onChange={handleUnassignedToggle}
                      />
                      <span>Show only unassigned items</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="filter-item">
            <h3>Response:</h3>
            <div className="dropdown-filter">
              <button 
                className="dropdown-toggle"
                onClick={() => setNeedsResponseDropdownOpen(!needsResponseDropdownOpen)}
              >
                Needs Response ▼
              </button>
              {needsResponseDropdownOpen && (
                <div className="dropdown-content">
                  <div className="dropdown-options">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedNeedsResponse}
                        onChange={handleNeedsResponseToggle}
                      />
                      <span>Show only items needing response 🚩</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="filter-item">
            <h3>Columns:</h3>
            <div className="dropdown-filter">
              <button 
                className="dropdown-toggle"
                onClick={() => setColumnsDropdownOpen(!columnsDropdownOpen)}
              >
                Columns ({visibleColumns.size}/8) ▼
              </button>
              {columnsDropdownOpen && (
                <div className="dropdown-content">
                  <div className="dropdown-options">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('labels')}
                        onChange={() => handleColumnToggle('labels')}
                      />
                      <span>Labels</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('assignees')}
                        onChange={() => handleColumnToggle('assignees')}
                      />
                      <span>Assignees</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('created')}
                        onChange={() => handleColumnToggle('created')}
                      />
                      <span>Issue created</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('updated')}
                        onChange={() => handleColumnToggle('updated')}
                      />
                      <span>Issue updated</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('lastComment')}
                        onChange={() => handleColumnToggle('lastComment')}
                      />
                      <span>Last comment</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('needsResponse')}
                        onChange={() => handleColumnToggle('needsResponse')}
                      />
                      <span>Needs response</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('timeline')}
                        onChange={() => handleColumnToggle('timeline')}
                      />
                      <span>ETA</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="roadmap-table">
        <table className="table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => handleSort('title')}>
                Feature{getSortIcon('title')}
              </th>
              {visibleColumns.has('labels') && (
                <th>Labels</th>
              )}
              {visibleColumns.has('assignees') && (
                <th className="sortable" onClick={() => handleSort('assignees')}>
                  Assignees{getSortIcon('assignees')}
                </th>
              )}
              {visibleColumns.has('created') && (
                <th className="sortable" onClick={() => handleSort('createdAt')}>
                  Issue created{getSortIcon('createdAt')}
                </th>
              )}
              {visibleColumns.has('updated') && (
                <th className="sortable" onClick={() => handleSort('updatedAt')}>
                  Issue updated{getSortIcon('updatedAt')}
                </th>
              )}
              {visibleColumns.has('lastComment') && (
                <th className="sortable" onClick={() => handleSort('lastComment')}>
                  Last comment{getSortIcon('lastComment')}
                </th>
              )}
              {visibleColumns.has('needsResponse') && (
                <th>Needs response</th>
              )}
              {visibleColumns.has('timeline') && (
                <th>ETA</th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="feature-cell">
                    <a 
                      href={item.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="issue-title"
                    >
                      {item.title}
                    </a>
                    <div className="status-under-title">
                      <span className={`status-badge-small ${getStatusBadgeClass(item.status)}`}>
                        {abbreviateStatus(item.status)}
                      </span>
                    </div>
                  </div>
                </td>
                {visibleColumns.has('labels') && (
                  <td>
                    <div className="labels">
                      {item.labels.map((label) => (
                        <span 
                          key={label.name} 
                          className="label-badge table-label"
                          style={{ backgroundColor: `#${label.color}`, color: '#fff' }}
                        >
                          {label.name}
                        </span>
                      ))}
                    </div>
                  </td>
                )}
                {visibleColumns.has('assignees') && (
                  <td>
                    <div className="assignees">
                      {item.assignees.length > 0 ? (
                        item.assignees.map((assignee) => (
                          <div key={assignee.login} className="assignee">
                            <img src={assignee.avatarUrl} alt={assignee.login} />
                            <span>{assignee.name || assignee.login}</span>
                          </div>
                        ))
                      ) : (
                        <span style={{ color: '#666', fontSize: '12px' }}>Unassigned</span>
                      )}
                    </div>
                  </td>
                )}
                {visibleColumns.has('created') && (
                  <td>
                    <div className="date-info">
                      {formatDate(item.createdAt)}
                      <br />
                      <small>({getWaitingTime(item.createdAt)} ago)</small>
                    </div>
                  </td>
                )}
                {visibleColumns.has('updated') && (
                  <td>
                    <div className="date-info">
                      {item.lastEditedAt ? (
                        <>
                          {formatDate(item.lastEditedAt)}
                          <br />
                          <small>({getTimeAgo(item.lastEditedAt)})</small>
                        </>
                      ) : null}
                    </div>
                  </td>
                )}
                {visibleColumns.has('lastComment') && (
                  <td>
                    <div className="date-info">
                      {item.lastComment ? (
                        <>
                          {formatDate(item.lastComment.createdAt)}
                          <br />
                          <small>by {item.lastComment.author.name || item.lastComment.author.login}</small>
                        </>
                      ) : (
                        <span style={{ color: '#666', fontSize: '12px' }}>No comments</span>
                      )}
                    </div>
                  </td>
                )}
                {visibleColumns.has('needsResponse') && (
                  <td>
                    {item.needsResponse && (
                      <span className="needs-response-flag" title="Needs response from team">
                        🚩
                      </span>
                    )}
                  </td>
                )}
                {visibleColumns.has('timeline') && (
                  <td>
                    {item.extractedEta ? (
                      <a 
                        href={item.extractedEta.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="extracted-date"
                        title={`ETA from ${item.extractedEta.author}: ${item.extractedEta.commentText}`}
                      >
                        {item.extractedEta.date}
                      </a>
                    ) : item.extractedDate ? (
                      <div className={`extracted-date ${item.extractedDate === 'OpenAI extraction failed' ? 'extraction-failed' : ''}`}>
                        {item.extractedDate}
                      </div>
                    ) : (
                      !item.status.toLowerCase().includes('backlog') && 
                      !item.status.toLowerCase().includes('archive') ? (
                        <span style={{ color: '#999', fontSize: '12px' }}>
                          No ETA found
                        </span>
                      ) : null
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RoadmapPage;