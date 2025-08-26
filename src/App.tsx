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
}

const App: React.FC = () => {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [selectedAssignees, setSelectedAssignees] = useState<Set<string>>(new Set());
  const [labelsDropdownOpen, setLabelsDropdownOpen] = useState(false);
  const [assigneesDropdownOpen, setAssigneesDropdownOpen] = useState(false);
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<{step: string, current: number, total: number} | null>(null);

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
      // Load saved filters from localStorage
      const savedStatuses = localStorage.getItem('selectedStatuses');
      const savedLabels = localStorage.getItem('selectedLabels');
      const savedAssignees = localStorage.getItem('selectedAssignees');
      
      if (savedStatuses) {
        setSelectedStatuses(new Set(JSON.parse(savedStatuses)));
      } else {
        // Set default selected statuses (exclude Archive, Backlog, and GA)
        const uniqueStatuses = [...new Set(items.map(item => item.status))];
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
        // Set default selected labels (all labels)
        const uniqueLabels = [...new Set(items.flatMap(item => item.labels.map(label => label.name)))]
        setSelectedLabels(new Set(uniqueLabels));
      }
      
      if (savedAssignees) {
        setSelectedAssignees(new Set(JSON.parse(savedAssignees)));
      } else {
        // Set default selected assignees (all assignees)
        const uniqueAssignees = [...new Set(items.flatMap(item => item.assignees.map(assignee => assignee.name || assignee.login)))]
        setSelectedAssignees(new Set(uniqueAssignees));
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
      const eventSource = new EventSource('/api/progress');
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
      item.assignees.length === 0 ||
      item.assignees.some(assignee => selectedAssignees.has(assignee.name || assignee.login));
    return statusMatch && labelMatch && assigneeMatch;
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
          <button 
            className={`refresh-button-small ${isDataRecent() ? 'disabled' : ''}`}
            onClick={handleRefresh}
            disabled={refreshing || isDataRecent()}
          >
            {refreshing ? '⟳' : '↻'}
          </button>
        </div>
      </div>

      <div className="filters">
        <div className="filter-section">
          <h3>Filter by Status:</h3>
          <div className="checkbox-group status-grid">
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
        
        <div className="filter-section">
          <h3>Filter by Labels:</h3>
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
        
        <div className="filter-section">
          <h3>Filter by Assignees:</h3>
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
      </div>

      <div className="roadmap-table">
        <table className="table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => handleSort('title')}>
                Feature{getSortIcon('title')}
              </th>
              <th>Labels</th>
              <th className="sortable" onClick={() => handleSort('assignees')}>
                Assignees{getSortIcon('assignees')}
              </th>
              <th className="sortable" onClick={() => handleSort('createdAt')}>
                Created{getSortIcon('createdAt')}
              </th>
              <th className="sortable" onClick={() => handleSort('updatedAt')}>
                Last Updated{getSortIcon('updatedAt')}
              </th>
              <th>Customer Timeline</th>
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
                <td>
                  <div className="date-info">
                    {formatDate(item.createdAt)}
                    <br />
                    <small>({getWaitingTime(item.createdAt)} ago)</small>
                  </div>
                </td>
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
                <td>
                  {item.extractedDate ? (
                    <div className={`extracted-date ${item.extractedDate === 'OpenAI extraction failed' ? 'extraction-failed' : ''}`}>
                      {item.extractedDate}
                    </div>
                  ) : (
                    !item.status.toLowerCase().includes('backlog') && 
                    !item.status.toLowerCase().includes('archive') ? (
                      <span style={{ color: '#999', fontSize: '12px' }}>
                        No timeline found
                      </span>
                    ) : null
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default App;