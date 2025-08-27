import React, { useState, useEffect } from 'react';

interface AKSIssue {
  id: string;
  title: string;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  labels: Array<{
    name: string;
    color: string;
  }>;
  assignees: Array<{
    login: string;
    name: string | null;
    avatarUrl: string;
  }>;
  state: string;
  comments: number;
  lastComment?: {
    createdAt: string;
    author: {
      login: string;
      name: string | null;
    };
  } | null;
  needsResponse?: boolean;
  aiSummary?: {
    currentStatus: string;
    nextSteps: string;
    analysis: {
      isKnownIssue: boolean;
      isExpectedBehaviour: boolean;
      shouldClose: boolean;
    };
  } | null;
}

const AKSIssuesPage: React.FC = () => {
  const [issues, setIssues] = useState<AKSIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [selectedAssignees, setSelectedAssignees] = useState<Set<string>>(new Set());
  const [selectedUnassigned, setSelectedUnassigned] = useState<boolean>(false);
  const [labelsDropdownOpen, setLabelsDropdownOpen] = useState(false);
  const [assigneesDropdownOpen, setAssigneesDropdownOpen] = useState(false);
  const [unassignedDropdownOpen, setUnassignedDropdownOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(['title', 'labels', 'assignees', 'created', 'updated', 'lastComment', 'needsResponse', 'ai']));
  const [columnsDropdownOpen, setColumnsDropdownOpen] = useState(false);
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [hoveredIssue, setHoveredIssue] = useState<string | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{x: number, y: number}>({x: 0, y: 0});
  const [progress, setProgress] = useState<{step: string, current: number, total: number} | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copyLinkSuccess, setCopyLinkSuccess] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    fetchAKSIssues();
    fetchCacheInfo();
  }, []);

  useEffect(() => {
    if (issues.length > 0) {
      // Check if URL has filter parameters
      const urlParams = new URLSearchParams(window.location.search);
      const hasUrlFilters = urlParams.toString().length > 0;
      
      // Get all unique values for comparison
      const uniqueLabelsFromData = [...new Set(issues.flatMap(issue => issue.labels.map(label => label.name)))].sort();
      const uniqueAssigneesFromData = [...new Set(issues.flatMap(issue => issue.assignees.map(assignee => assignee.name || assignee.login)))].sort();
      
      if (hasUrlFilters) {
        // Load filters from URL
        if (urlParams.has('labels')) {
          const labels = urlParams.get('labels')?.split(',').filter(l => l) || [];
          setSelectedLabels(new Set(labels));
        } else {
          // No labels param means all are selected
          setSelectedLabels(new Set(uniqueLabelsFromData));
        }
        
        if (urlParams.has('assignees')) {
          const assignees = urlParams.get('assignees')?.split(',').filter(a => a) || [];
          setSelectedAssignees(new Set(assignees));
        } else {
          // No assignees param means all are selected
          setSelectedAssignees(new Set(uniqueAssigneesFromData));
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
        const savedLabels = localStorage.getItem('aksSelectedLabels');
        const savedAssignees = localStorage.getItem('aksSelectedAssignees');
        const savedUnassigned = localStorage.getItem('aksSelectedUnassigned');
        const savedVisibleColumns = localStorage.getItem('aksVisibleColumns');
        
        if (savedLabels) {
          setSelectedLabels(new Set(JSON.parse(savedLabels)));
        } else {
          setSelectedLabels(new Set(uniqueLabelsFromData));
        }
        
        if (savedAssignees) {
          setSelectedAssignees(new Set(JSON.parse(savedAssignees)));
        } else {
          setSelectedAssignees(new Set(uniqueAssigneesFromData));
        }
        
        if (savedUnassigned) {
          setSelectedUnassigned(JSON.parse(savedUnassigned));
        }
        
        if (savedVisibleColumns) {
          setVisibleColumns(new Set(JSON.parse(savedVisibleColumns)));
        }
      }
    }
  }, [issues]);

  const fetchAKSIssues = async (forceRefresh = false) => {
    let cleanup: (() => void) | null = null;
    
    try {
      setLoading(true);
      if (forceRefresh) {
        setRefreshing(true);
      }
      
      // Set up Server-Sent Events for progress updates for both initial load and refresh
      const eventSource = new EventSource('/api/progress?type=aks');
      eventSource.onmessage = (event) => {
        try {
          const progressData = JSON.parse(event.data);
          console.log('Progress update received:', progressData);
          setProgress(progressData);
        } catch (e) {
          console.error('Failed to parse progress data:', e);
        }
      };
      
      eventSource.onopen = () => {
        console.log('EventSource connection opened');
      };
      
      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        eventSource.close();
      };
      
      // Clean up event source when request completes
      cleanup = () => {
        eventSource.close();
        setProgress(null);
      };
      
      setTimeout(() => cleanup?.(), 600000); // Cleanup after 10 minutes (AKS processing can take a long time)
      
      // Add a small delay to ensure EventSource is connected before starting the request
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const url = forceRefresh ? '/api/aks-issues?refresh=true' : '/api/aks-issues';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setIssues(data);
      
      if (forceRefresh) {
        await fetchCacheInfo();
      }
      
      // Clean up when done
      cleanup?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch AKS issues');
      // Clean up on error too
      cleanup?.();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchCacheInfo = async () => {
    try {
      const response = await fetch('/api/cache-info?type=aks');
      if (response.ok) {
        const data = await response.json();
        setLastUpdated(data.lastUpdated);
      }
    } catch (err) {
      console.error('Failed to fetch cache info:', err);
    }
  };

  const isDataRecent = () => {
    if (!lastUpdated) return false;
    const updated = new Date(lastUpdated);
    const now = new Date();
    const diffMinutes = (now.getTime() - updated.getTime()) / (1000 * 60);
    return diffMinutes < 1;
  };

  const handleRefresh = () => {
    if (isDataRecent() && !refreshing) {
      if (!confirm('Data was refreshed less than a minute ago. This will take about a minute to complete. Are you sure?')) {
        return;
      }
    }
    fetchAKSIssues(true);
  };

  const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));
    
    return `refreshed ${diffHours} hours ${diffMinutes} minutes ago`;
  };

  const copyCurrentFiltersAsUrl = async () => {
    const url = new URL(window.location.href);
    url.search = '';
    
    const params = new URLSearchParams();
    
    // Only include labels if not all are selected
    if (selectedLabels.size > 0 && selectedLabels.size < uniqueLabels.length) {
      params.set('labels', Array.from(selectedLabels).join(','));
    }
    
    // Only include assignees if not all are selected
    if (selectedAssignees.size > 0 && selectedAssignees.size < uniqueAssignees.length) {
      params.set('assignees', Array.from(selectedAssignees).join(','));
    }
    
    // Only include boolean filters if they're true (non-default)
    if (selectedUnassigned) {
      params.set('unassigned', 'true');
    }
    
    // Only include columns if not the default set
    const defaultColumns = new Set(['title', 'labels', 'assignees', 'created', 'updated', 'lastComment', 'needsResponse', 'ai']);
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

  const filteredIssues = issues.filter(issue => {
    const labelMatch = selectedLabels.size === 0 || 
      issue.labels.length === 0 || 
      issue.labels.some(label => selectedLabels.has(label.name));
    const assigneeMatch = selectedAssignees.size === 0 ||
      issue.assignees.some(assignee => selectedAssignees.has(assignee.name || assignee.login));
    const unassignedMatch = !selectedUnassigned || issue.assignees.length === 0;
    return labelMatch && assigneeMatch && unassignedMatch;
  });

  const sortedIssues = [...filteredIssues].sort((a, b) => {
    if (!sortField) return 0;
    
    let aValue: any, bValue: any;
    
    switch (sortField) {
      case 'title':
        aValue = a.title.toLowerCase();
        bValue = b.title.toLowerCase();
        break;
      case 'createdAt':
        aValue = new Date(a.createdAt);
        bValue = new Date(b.createdAt);
        break;
      case 'updatedAt':
        aValue = new Date(a.updatedAt);
        bValue = new Date(b.updatedAt);
        break;
      case 'lastComment':
        aValue = a.lastComment ? new Date(a.lastComment.createdAt) : new Date(0);
        bValue = b.lastComment ? new Date(b.lastComment.createdAt) : new Date(0);
        break;
      case 'comments':
        aValue = a.comments;
        bValue = b.comments;
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
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

  const uniqueLabels = [...new Set(issues.flatMap(issue => issue.labels.map(label => label.name)))].sort();
  const uniqueAssignees = [...new Set(issues.flatMap(issue => issue.assignees.map(assignee => assignee.name || assignee.login)))].sort();

  const handleLabelToggle = (label: string) => {
    const newSelected = new Set(selectedLabels);
    if (newSelected.has(label)) {
      newSelected.delete(label);
    } else {
      newSelected.add(label);
    }
    setSelectedLabels(newSelected);
    localStorage.setItem('aksSelectedLabels', JSON.stringify([...newSelected]));
  };

  const handleLabelSelectAll = () => {
    if (selectedLabels.size === uniqueLabels.length) {
      setSelectedLabels(new Set());
      localStorage.setItem('aksSelectedLabels', JSON.stringify([]));
    } else {
      setSelectedLabels(new Set(uniqueLabels));
      localStorage.setItem('aksSelectedLabels', JSON.stringify(uniqueLabels));
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
    localStorage.setItem('aksSelectedAssignees', JSON.stringify([...newSelected]));
  };

  const handleAssigneeSelectAll = () => {
    if (selectedAssignees.size === uniqueAssignees.length) {
      setSelectedAssignees(new Set());
      localStorage.setItem('aksSelectedAssignees', JSON.stringify([]));
    } else {
      setSelectedAssignees(new Set(uniqueAssignees));
      localStorage.setItem('aksSelectedAssignees', JSON.stringify(uniqueAssignees));
    }
  };

  const handleUnassignedToggle = () => {
    const newValue = !selectedUnassigned;
    setSelectedUnassigned(newValue);
    localStorage.setItem('aksSelectedUnassigned', JSON.stringify(newValue));
  };

  const handleColumnToggle = (column: string) => {
    const newVisible = new Set(visibleColumns);
    if (newVisible.has(column)) {
      newVisible.delete(column);
    } else {
      newVisible.add(column);
    }
    setVisibleColumns(newVisible);
    localStorage.setItem('aksVisibleColumns', JSON.stringify([...newVisible]));
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

  const getAIThinksLabel = (aiSummary: AKSIssue['aiSummary']) => {
    if (!aiSummary) return null;
    
    const { isKnownIssue, isExpectedBehaviour, shouldClose } = aiSummary.analysis;
    
    if (isKnownIssue) return 'KNOWN ISSUE';
    if (isExpectedBehaviour) return 'EXPECTED BEHAVIOUR';
    if (shouldClose) return 'GOOD TO CLOSE';
    return null;
  };

  const handleMouseEnter = (issueId: string, event: React.MouseEvent) => {
    setHoveredIssue(issueId);
    
    // Smart positioning to prevent clipping
    const popoverWidth = 400; // max-width from CSS
    const popoverHeight = 300; // estimated height
    const margin = 15; // margin from viewport edge
    
    let x = event.clientX + 10;
    let y = event.clientY + 10;
    
    // Check right edge - if popover would go off screen, position it to the left of cursor
    if (x + popoverWidth > window.innerWidth - margin) {
      x = event.clientX - popoverWidth - 10;
    }
    
    // Check bottom edge - if popover would go off screen, position it above cursor
    if (y + popoverHeight > window.innerHeight - margin) {
      y = event.clientY - popoverHeight - 10;
    }
    
    // Ensure popover doesn't go off left edge
    if (x < margin) {
      x = margin;
    }
    
    // Ensure popover doesn't go off top edge
    if (y < margin) {
      y = margin;
    }
    
    setPopoverPosition({ x, y });
  };

  const handleMouseLeave = () => {
    setHoveredIssue(null);
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
            'Loading Azure AKS issues...'
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
            <h1>Azure AKS Open Issues Analysis</h1>
            <p>Analyzing all open issues from Azure/AKS repository (~600 issues)</p>
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
                        checked={visibleColumns.has('ai')}
                        onChange={() => handleColumnToggle('ai')}
                      />
                      <span>AI</span>
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
                Issue{getSortIcon('title')}
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
              {visibleColumns.has('ai') && (
                <th>AI</th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedIssues.map((issue) => (
              <tr key={issue.id}>
                <td>
                  <div className="feature-cell">
                    <a 
                      href={issue.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="issue-title"
                    >
                      {issue.title}
                    </a>
                  </div>
                </td>
                {visibleColumns.has('labels') && (
                  <td>
                    <div className="labels">
                      {issue.labels.map((label) => (
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
                      {issue.assignees.length > 0 ? (
                        issue.assignees.map((assignee) => (
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
                      {formatDate(issue.createdAt)}
                      <br />
                      <small>({getTimeAgo(issue.createdAt)})</small>
                    </div>
                  </td>
                )}
                {visibleColumns.has('updated') && (
                  <td>
                    <div className="date-info">
                      {formatDate(issue.updatedAt)}
                      <br />
                      <small>({getTimeAgo(issue.updatedAt)})</small>
                    </div>
                  </td>
                )}
                {visibleColumns.has('lastComment') && (
                  <td>
                    <div className="date-info">
                      {issue.lastComment ? (
                        <>
                          {formatDate(issue.lastComment.createdAt)}
                          <br />
                          <small>by {issue.lastComment.author.name || issue.lastComment.author.login}</small>
                        </>
                      ) : (
                        <span style={{ color: '#666', fontSize: '12px' }}>No comments</span>
                      )}
                    </div>
                  </td>
                )}
                {visibleColumns.has('needsResponse') && (
                  <td>
                    {issue.needsResponse && (
                      <span className="needs-response-flag" title="Needs response from team">
                        🚩
                      </span>
                    )}
                  </td>
                )}
                {visibleColumns.has('ai') && (
                  <td>
                    <div 
                      className="ai-thinks-cell"
                      onMouseEnter={(e) => handleMouseEnter(issue.id, e)}
                      onMouseLeave={handleMouseLeave}
                    >
                      {issue.aiSummary ? (
                        <>
                          {getAIThinksLabel(issue.aiSummary) ? (
                            <span className="ai-thinks-label">
                              {getAIThinksLabel(issue.aiSummary)}
                            </span>
                          ) : (
                            <span className="ai-thinks-label" style={{ backgroundColor: '#6c757d' }}>
                              ANALYZED
                            </span>
                          )}
                          {hoveredIssue === issue.id && (
                            <div 
                              className="ai-summary-popover"
                              style={{
                                position: 'fixed',
                                top: popoverPosition.y,
                                left: popoverPosition.x,
                                zIndex: 1001,
                                maxWidth: '400px',
                                maxHeight: '300px',
                                overflow: 'auto'
                              }}
                            >
                              <div className="ai-summary-content">
                                <h4>Current Status</h4>
                                <p>{issue.aiSummary.currentStatus}</p>
                                <h4>Next Steps</h4>
                                <p>{issue.aiSummary.nextSteps}</p>
                                <h4>Analysis</h4>
                                <ul>
                                  <li>Known Issue: {issue.aiSummary.analysis.isKnownIssue ? 'Yes' : 'No'}</li>
                                  <li>Expected Behaviour: {issue.aiSummary.analysis.isExpectedBehaviour ? 'Yes' : 'No'}</li>
                                  <li>Should Close: {issue.aiSummary.analysis.shouldClose ? 'Yes' : 'No'}</li>
                                </ul>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="ai-processing">Processing...</span>
                      )}
                    </div>
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

export default AKSIssuesPage;