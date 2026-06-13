package app.gitvisualizer.events.dto;

public record EventView(
		String id,
		String type,
		String createdAt,
		ActorView actor,
		RepoView repo,
		String summary,
		String ref,
		String action,
		Integer prNumber,
		String commitMessage
) {
}
