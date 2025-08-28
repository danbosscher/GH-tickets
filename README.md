# Azure AKS Analytics Dashboard

A React/TypeScript web application that provides comprehensive analytics for Azure AKS, including the public roadmap from GitHub Project #685 and open issues analysis, both enhanced with AI-powered insights.

## Features

### Roadmap Viewer
- **Interactive Filtering**: Filter roadmap items by status, labels, and assignees with dropdown multi-select
- **Smart Timeline Extraction**: Uses Azure OpenAI to extract customer timeline information from issue descriptions
- **Real-time Progress**: Shows progress during data refresh operations
- **SQLite Caching**: Efficient caching of both GitHub data and AI extractions with background retry system

### AKS Issues Analysis
- **Comprehensive Issue Tracking**: View and analyze all open AKS GitHub issues
- **AI-Powered Insights**: Automated analysis of issue status, next steps, and recommendations
- **Advanced Filtering**: Filter by labels, assignees, and response status
- **Smart Issue Classification**: AI determines if issues are known problems, expected behavior, or candidates for closure
- **Response Tracking**: Identify issues that need team response

### Shared Features
- **Responsive Design**: Clean, modern interface optimized for data visualization
- **Persistent Preferences**: Remembers filter selections using localStorage
- **Column Customization**: Show/hide columns based on your needs

## Setup

### Prerequisites

- Node.js 18+
- GitHub Personal Access Token with `read:org` and `read:project` permissions
- Azure OpenAI service with GPT deployment

### Environment Variables

Create a `.env` file in the root directory:

```env
GITHUB_TOKEN=your_github_token_here
AZURE_OPENAI_API_KEY=your_azure_openai_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT_NAME=your-gpt-deployment-name
NODE_ENV=development
```

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Deployment

This application is configured for automatic deployment to Azure Container Instances via GitHub Actions.

### Required GitHub Secrets

Set these secrets in your GitHub repository settings:

- `AZURE_CREDENTIALS`: Azure service principal credentials (JSON format)
- `GH_TOKEN`: GitHub Personal Access Token
- `AZURE_OPENAI_API_KEY`: Azure OpenAI API key
- `AZURE_OPENAI_ENDPOINT`: Azure OpenAI endpoint URL
- `AZURE_OPENAI_DEPLOYMENT_NAME`: Azure OpenAI deployment name

### Azure Service Principal Setup

```bash
# Create service principal with contributor role
az ad sp create-for-rbac --name "aks-roadmap-sp" --role contributor --scopes /subscriptions/YOUR_SUBSCRIPTION_ID --sdk-auth
```

Use the output as the `AZURE_CREDENTIALS` secret value.

### Automatic Deployment

Push to `main` or `master` branch to trigger automatic deployment to Azure Container Instances.

## Architecture

- **Frontend**: React 18 with TypeScript
- **Backend**: Express.js with TypeScript
- **Database**: SQLite for caching
- **AI**: Azure OpenAI for timeline extraction and issue analysis
- **Deployment**: Docker + Azure Container Instances
- **CI/CD**: GitHub Actions

## API Endpoints

### Roadmap
- `GET /api/roadmap`: Fetch roadmap data (with caching)
- `GET /api/roadmap?refresh=true`: Force refresh from GitHub
- `GET /api/cache-info`: Get cache timestamp information

### AKS Issues
- `GET /api/aks-issues`: Fetch AKS issues data (with caching)
- `GET /api/aks-issues?refresh=true`: Force refresh from GitHub

### Progress Tracking
- `GET /api/progress`: Server-sent events for progress updates

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License