package app.gitvisualizer.events;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import app.gitvisualizer.events.service.EventService;

@WebMvcTest(EventsController.class)
class EventsControllerTest {

	@Autowired
	private MockMvc mockMvc;

	@MockitoBean
	private EventService eventService;

	@Test
	void opensSseStreamWithReplay() throws Exception {
		SseEmitter emitter = new SseEmitter();
		when(eventService.subscribeToStream(anyInt())).thenReturn(emitter);

		mockMvc.perform(get("/api/stream/events?replay=10"))
				.andExpect(status().isOk())
				.andExpect(request().asyncStarted());

		verify(eventService).subscribeToStream(10);
	}
}
